//! 阶段 2（T2.2+2.3 合并）删除级联演练 + 对账：内存库上验证 `edges` 双端
//! `ON DELETE CASCADE` 与今天 `delete_subtree`/`gc_orphans` 逐值一致（spec §2.3），
//! 并补「老链接表 <-> `edges`」双向等价与阶段 2 对账读数。分节：级联 ①–④、对账 ⑤–⑨。
use super::entities_tags_fixture::{add_tag, count, migrate_to_v23, seed_notes, seed_v23};
use super::*;
use crate::db::repos::entities::reconcile::assert_cache_matches_edges;
use crate::db::repos::entities::TAG_ID_OFFSET;

/// 迁移前的老触发器集合（记忆 #1290）；024/025 只增新表，一个都不动。
const LEGACY_TRIGGERS: [&str; 8] = [
    "notes_ad",
    "notes_ai",
    "notes_au",
    "tag_aliases_ad",
    "tag_aliases_ai",
    "tag_aliases_au",
    "tag_links_ad",
    "tag_links_ai",
];

/// `seed_v23` + `seed_notes`，再补两个空壳：4「空壳」挂 1 下（有父、无链接、无子）、
/// 5「孤立根」（无父无链接无子）。老 `gc_orphans` 要回收「有父但无链接无子」，新口径必须同样回收。
fn seeded_v25() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    seed_notes(&c);
    add_tag(&c, 4, "空壳", Some(1), "地点轴/空壳", 2);
    add_tag(&c, 5, "孤立根", None, "孤立根", 1);
    run(&c).unwrap();
    c
}

fn tag(id: i64) -> i64 {
    id + TAG_ID_OFFSET
}

fn ids(c: &Connection, sql: &str) -> Vec<i64> {
    let mut s = c.prepare(sql).unwrap();
    s.query_map([], |r| r.get::<_, i64>(0)).unwrap().map(|x| x.unwrap()).collect()
}

/// 边摘要（两端 | kind | remark），排序确定：删除前后比较「其余行不动」。
fn edge_dump(c: &Connection) -> Vec<String> {
    let mut s = c
        .prepare("SELECT source_id||'|'||target_id||'|'||kind||'|'||remark FROM edges \
                  ORDER BY source_id, target_id, kind")
        .unwrap();
    s.query_map([], |r| r.get::<_, String>(0)).unwrap().map(|x| x.unwrap()).collect()
}

/// 今天 `gc_orphans` 的三条件（无出 `tag_links`、非关系目标、无子节点）。
const OLD_ORPHANS: &str = "SELECT id FROM tags WHERE \
  NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.tag_id = tags.id) \
  AND NOT EXISTS (SELECT 1 FROM tag_links c WHERE c.target_type IN ('tag','type') AND c.target_id = tags.id) \
  AND NOT EXISTS (SELECT 1 FROM tags ch WHERE ch.parent_id = tags.id)";

/// 边表口径：无出边 + 无入边。**父子入边（有父）不算「入边」** —— 否则「有父但无链接无子」
/// 的空壳会被留下，与 `tree_legacy_name_tests::gc_orphans_keeps_parents_with_children_and_prunes_dead_chain`
/// 的「整条无用链逐层回收」冲突；旧口径唯一被排除的正是这条父指针。
const NEW_ORPHANS: &str = "SELECT e.id - 1000000000 FROM entities e WHERE e.kind='tag' \
  AND NOT EXISTS (SELECT 1 FROM edges g WHERE g.source_id = e.id) \
  AND NOT EXISTS (SELECT 1 FROM edges g WHERE g.target_id = e.id AND g.kind <> 'child')";

/// ① 删笔记实体：CASCADE 带走它的 tagging / link 出边，实体消失，其余边逐条不动。
#[test]
fn delete_note_cascades_edges() {
    let c = seeded_v25();
    let before = edge_dump(&c);
    c.execute("DELETE FROM entities WHERE id = 501", []).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE id = 501"), 0);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM edges WHERE source_id = 501 OR target_id = 501"),
        0,
        "删笔记后不得残留任何以它为端的边"
    );
    let gone = [format!("501|{}|tagging|", tag(2)), format!("501|{}|tagging|", tag(3)), "501|502|link|".into()];
    let kept: Vec<String> = before.iter().filter(|e| !gone.contains(e)).cloned().collect();
    assert_eq!((edge_dump(&c).len(), edge_dump(&c)), (before.len() - 3, kept), "恰好消失 2 tagging + 1 link");
}

/// ② 删被笔记链接的叶子标签：tagging / child / relation 入边一起消失，父标签仍在。
#[test]
fn delete_tag_cascades_in_edges() {
    let c = seeded_v25();
    let jp = tag(2);
    c.execute("DELETE FROM entities WHERE id = ?1", [jp]).unwrap();
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM entities WHERE id = {jp}")), 0);
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM edges WHERE source_id = {jp} OR target_id = {jp}")),
        0,
        "被删标签不得残留边"
    );
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM entities WHERE id = {}", tag(1))), 1, "父标签仍在");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM entities WHERE id = {}", tag(3))), 1, "relation 源仍在");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='tagging'"), 1, "只剩 501 -> 中国");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='relation'"), 0, "指向日本的关系边随目标消失");
}

/// ③ `gc_orphans` 等价：老三条件集合 == 边表口径集合（同库取集合，双向 EXCEPT 皆空）。
#[test]
fn gc_orphan_sets_are_equivalent() {
    let c = seeded_v25();
    assert_eq!(ids(&c, OLD_ORPHANS), vec![4, 5], "两个空壳老口径都回收（4 有父亦回收）");
    assert_eq!(ids(&c, NEW_ORPHANS), vec![4, 5], "新口径必须留下同一集合");
    let fwd = format!("SELECT COUNT(*) FROM ({OLD_ORPHANS} EXCEPT {NEW_ORPHANS})");
    let bwd = format!("SELECT COUNT(*) FROM ({NEW_ORPHANS} EXCEPT {OLD_ORPHANS})");
    assert_eq!((count(&c, &fwd), count(&c, &bwd)), (0, 0), "gc 等价集合双向 EXCEPT 必须 0 行");
}

/// ④ D2 选项 A：`note_links.target_id IS NULL` 的未解析行不落 `link` 边，仍留在老表。
#[test]
fn unresolved_note_links_do_not_become_edges() {
    let c = seeded_v25();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM note_links WHERE target_id IS NULL"), 1);
    assert_eq!(edge_dump(&c).iter().filter(|e| e.contains("|link|")).count(), 1, "只 1 条已解析 link 边");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link' AND source_id=502"), 0, "未解析不落边");
}

/// ⑤ spec §3 五条缓存对账全过（path/depth 与 child 边一致 = D4 硬要求）。
#[test]
fn phase2_cache_reconcile_passes() {
    assert_cache_matches_edges(&seeded_v25());
}

/// ⑥ `tagging` 边反向后与老 `tag_links(target_type='note')` 双向 EXCEPT 空（含偏移换算）。
#[test]
fn tagging_edges_equal_tag_links() {
    let c = seeded_v25();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='note'"), 3, "夹具非空");
    let fwd = format!(
        "SELECT COUNT(*) FROM (SELECT target_id, tag_id + {TAG_ID_OFFSET} FROM tag_links \
         WHERE target_type='note' EXCEPT SELECT source_id, target_id FROM edges WHERE kind='tagging')"
    );
    let bwd = format!(
        "SELECT COUNT(*) FROM (SELECT target_id - {TAG_ID_OFFSET}, source_id FROM edges \
         WHERE kind='tagging' EXCEPT SELECT tag_id, target_id FROM tag_links WHERE target_type='note')"
    );
    assert_eq!((count(&c, &fwd), count(&c, &bwd)), (0, 0), "tagging 双向等价");
}

/// ⑦ `relation` 边反向后与老 `tag_links(target_type IN ('tag','type'))` 双向空（`remark` 一并比对）。
#[test]
fn relation_edges_equal_tag_links() {
    let c = seeded_v25();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type IN ('tag','type')"), 1, "夹具非空");
    let fwd = format!(
        "SELECT COUNT(*) FROM (SELECT tag_id + {TAG_ID_OFFSET}, target_id + {TAG_ID_OFFSET}, remark \
         FROM tag_links WHERE target_type IN ('tag','type') EXCEPT SELECT source_id, target_id, remark \
         FROM edges WHERE kind='relation')"
    );
    let bwd = format!(
        "SELECT COUNT(*) FROM (SELECT source_id - {TAG_ID_OFFSET}, target_id - {TAG_ID_OFFSET}, remark \
         FROM edges WHERE kind='relation' EXCEPT SELECT tag_id, target_id, remark \
         FROM tag_links WHERE target_type IN ('tag','type'))"
    );
    assert_eq!((count(&c, &fwd), count(&c, &bwd)), (0, 0), "relation 双向等价");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='relation' AND remark='国籍'"), 1, "属性名跟着边");
}

/// ⑧ 老表计数不变：025 前后老表行数逐值相同，新表计数符合预期。
#[test]
fn legacy_counts_unchanged_by_phase2() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    seed_notes(&c);
    add_tag(&c, 4, "空壳", Some(1), "地点轴/空壳", 2);
    add_tag(&c, 5, "孤立根", None, "孤立根", 1);
    let snap = |c: &Connection| {
        (count(c, "SELECT COUNT(*) FROM notes"), count(c, "SELECT COUNT(*) FROM tags"),
         count(c, "SELECT COUNT(*) FROM tag_links"), count(c, "SELECT COUNT(*) FROM note_links"))
    };
    let before = snap(&c);
    run(&c).unwrap();
    assert_eq!(snap(&c), before, "025 不得改老表行数");
    assert_eq!(before, (2, 5, 4, 2), "夹具基数");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities"), 7, "5 标签 + 2 笔记");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges"), 8, "child 3 + tagging 3 + relation 1 + link 1");
}

/// ⑨ 触发器仍是 8 个老名字：阶段 2 不新增/重命名触发器。
#[test]
fn legacy_triggers_unchanged_in_phase2() {
    let c = seeded_v25();
    let mut s = c.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").unwrap();
    let names: Vec<String> = s.query_map([], |r| r.get::<_, String>(0)).unwrap().map(|x| x.unwrap()).collect();
    assert_eq!(names, LEGACY_TRIGGERS.map(String::from));
}
