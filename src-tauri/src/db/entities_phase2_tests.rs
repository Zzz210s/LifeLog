//! 阶段 2（T2.2+2.3 合并）删除级联演练 + 对账：内存库上验证 `edges` 双端
//! `ON DELETE CASCADE` 与今天 `delete_subtree`/`gc_orphans` 逐值一致（spec §2.3），
//! 并补「老链接表 <-> `edges`」双向等价与阶段 2 对账读数。分节:级联 ①–④、对账 ⑤–⑨。
//! 夹具停在 v26(阶段 2 终态):028 会重发全库 id 并把老链接表下架,偏移/老表断言只在 v26 成立。
use super::entities_phase2_fixture::{edge_dump, ids, seeded_v26, tag, NEW_ORPHANS, OLD_ORPHANS};
use super::entities_tags_fixture::{
    add_tag, count, migrate_to_v23, seed_notes, seed_v23, LEGACY_ENTITY_ID_OFFSET,
};
use super::*;
use crate::db::repos::entities::reconcile::assert_cache_matches_edges;

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

/// ① 删笔记实体：CASCADE 带走它的 tagging / link 出边，实体消失，其余边逐条不动。
#[test]
fn delete_note_cascades_edges() {
    let c = seeded_v26();
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

/// ①b 终态（v29）的 `edges` DDL 同样双端 CASCADE:删笔记实体带走它的出边，其余行逐条不动。
#[test]
fn final_schema_cascades_edges() {
    let c = seeded_v26();
    run(&c).unwrap();
    let before = edge_dump(&c);
    let note = ids(&c, "SELECT id FROM entities WHERE path IS NULL ORDER BY id")[0];
    c.execute("DELETE FROM entities WHERE id = ?1", [note]).unwrap();
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM edges WHERE source_id = {note} OR target_id = {note}")),
        0,
        "删笔记后不得残留任何以它为端的边"
    );
    let target = format!("|{note}|");
    let gone: Vec<String> = before
        .iter()
        .filter(|e| e.starts_with(&format!("{note}|")) || e.contains(&target))
        .cloned()
        .collect();
    let kept: Vec<String> = before.iter().filter(|e| !gone.contains(e)).cloned().collect();
    assert!(!gone.is_empty(), "夹具里该笔记应至少有一条出边");
    assert_eq!(edge_dump(&c), kept, "只带走该笔记的边,其余逐条不动");
}

/// ② 删被笔记链接的叶子标签：tagging / child / relation 入边一起消失，父标签仍在。
#[test]
fn delete_tag_cascades_in_edges() {
    let c = seeded_v26();
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
    let c = seeded_v26();
    assert_eq!(ids(&c, OLD_ORPHANS), vec![4, 5], "两个空壳老口径都回收（4 有父亦回收）");
    assert_eq!(ids(&c, NEW_ORPHANS), vec![4, 5], "新口径必须留下同一集合");
    let fwd = format!("SELECT COUNT(*) FROM ({OLD_ORPHANS} EXCEPT {NEW_ORPHANS})");
    let bwd = format!("SELECT COUNT(*) FROM ({NEW_ORPHANS} EXCEPT {OLD_ORPHANS})");
    assert_eq!((count(&c, &fwd), count(&c, &bwd)), (0, 0), "gc 等价集合双向 EXCEPT 必须 0 行");
}

/// ④ D2 选项 A：`note_links.target_id IS NULL` 的未解析行不落 `link` 边，仍留在老表。
#[test]
fn unresolved_note_links_do_not_become_edges() {
    let c = seeded_v26();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM note_links"), 2, "老表仍有 2 条 note_links");
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM note_links WHERE target_id IS NULL"),
        1,
        "其中恰 1 条未解析"
    );
    assert_eq!(edge_dump(&c).iter().filter(|e| e.contains("|link|")).count(), 1, "只 1 条已解析 link 边");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link' AND source_id=502"), 0, "未解析不落边");
}

/// ⑤ spec §3 五条缓存对账全过（path/depth 与 child 边一致 = D4 硬要求）。
/// 对账以 v28 结构为前置（列不存在时整组跳过），故本用例把夹具推到最新版。
#[test]
fn phase2_cache_reconcile_passes() {
    let c = seeded_v26();
    run(&c).unwrap();
    assert_cache_matches_edges(&c);
}

/// ⑥ `tagging` 边反向后与老 `tag_links(target_type='note')` 双向 EXCEPT 空（含偏移换算）。
#[test]
fn tagging_edges_equal_tag_links() {
    let c = seeded_v26();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='note'"), 3, "夹具非空");
    let fwd = format!(
        "SELECT COUNT(*) FROM (SELECT target_id, tag_id + {LEGACY_ENTITY_ID_OFFSET} FROM tag_links \
         WHERE target_type='note' EXCEPT SELECT source_id, target_id FROM edges WHERE kind='tagging')"
    );
    let bwd = format!(
        "SELECT COUNT(*) FROM (SELECT target_id - {LEGACY_ENTITY_ID_OFFSET}, source_id FROM edges \
         WHERE kind='tagging' EXCEPT SELECT tag_id, target_id FROM tag_links WHERE target_type='note')"
    );
    assert_eq!((count(&c, &fwd), count(&c, &bwd)), (0, 0), "tagging 双向等价");
}

/// ⑦ `relation` 边反向后与老 `tag_links(target_type IN ('tag','type'))` 双向空（`remark` 一并比对）。
#[test]
fn relation_edges_equal_tag_links() {
    let c = seeded_v26();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type IN ('tag','type')"), 1, "夹具非空");
    let fwd = format!(
        "SELECT COUNT(*) FROM (SELECT tag_id + {LEGACY_ENTITY_ID_OFFSET}, target_id + {LEGACY_ENTITY_ID_OFFSET}, remark \
         FROM tag_links WHERE target_type IN ('tag','type') EXCEPT SELECT source_id, target_id, remark \
         FROM edges WHERE kind='relation')"
    );
    let bwd = format!(
        "SELECT COUNT(*) FROM (SELECT source_id - {LEGACY_ENTITY_ID_OFFSET}, target_id - {LEGACY_ENTITY_ID_OFFSET}, remark \
         FROM edges WHERE kind='relation' EXCEPT SELECT tag_id, target_id, remark \
         FROM tag_links WHERE target_type IN ('tag','type'))"
    );
    assert_eq!((count(&c, &fwd), count(&c, &bwd)), (0, 0), "relation 双向等价");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='relation' AND remark='国籍'"), 1, "属性名跟着边");
}

/// ⑨ 阶段 2 本身不动触发器：单独跑 024 + 025（026 才会加 9 个新触发器）
#[test]
fn legacy_triggers_unchanged_in_phase2() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    seed_notes(&c);
    add_tag(&c, 4, "空壳", Some(1), "地点轴/空壳", 2);
    add_tag(&c, 5, "孤立根", None, "孤立根", 1);
    apply(&c, MIGRATIONS[23], 24).unwrap();
    apply(&c, MIGRATIONS[24], 25).unwrap();
    let mut s = c.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").unwrap();
    let names: Vec<String> = s.query_map([], |r| r.get::<_, String>(0)).unwrap().map(|x| x.unwrap()).collect();
    assert_eq!(names, LEGACY_TRIGGERS.map(String::from));
}
