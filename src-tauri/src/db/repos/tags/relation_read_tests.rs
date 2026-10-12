//! 标签关系的读方审计(设计 2026-10-06 §10 R8 / 计划 Task 1 §6;v31 点/线):
//! 收成两态后逐项复查 —— 删除标签显式清线、gc_orphans 保护"被指向"的标签、
//! 关系线不进 FTS / 不进导出 / 不改笔记 tags 列;线名只来自名字点(仅显示)。
use super::*;
use crate::db::repos::notes;
use crate::db::repos::tags::delete_subtree;
use crate::db::repos::tags::tag_facts;
use crate::db::repos::tags::tree::gc_orphans;
use crate::db::{migrate, repos};
use crate::exchange::notes_export;
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    c
}

fn ensure(c: &Connection, path: &str) -> i64 {
    repos::tags::ensure_path(c, &[path.to_string()]).unwrap()
}

fn segs(c: &Connection, parts: &[&str]) -> i64 {
    repos::tags::ensure_path(c, &parts.iter().map(|s| s.to_string()).collect::<Vec<_>>()).unwrap()
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM points WHERE path IS NOT NULL AND path=?1", params![path], |r| r.get(0)).unwrap()
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// ① 删除被指向的标签:指向它的线必须被显式清掉(to_id 上没有外键)
#[test]
fn delete_target_cleans_incoming_edges() {
    let mut c = db();
    let jia = ensure(&c, "甲");
    let target = segs(&c, &["地点轴", "国籍"]);
    set_tag_relation(&mut c, jia, target, "").unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines l JOIN points s ON s.id = l.from_id JOIN points t ON t.id = l.to_id WHERE (l.name_id IS NULL OR l.name_id <> 0) AND s.path IS NOT NULL"), 1);

    let root = id_at(&c, "地点轴");
    delete_subtree(&mut c, root).unwrap();

    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM lines l JOIN points s ON s.id = l.from_id JOIN points t ON t.id = l.to_id WHERE (l.name_id IS NULL OR l.name_id <> 0) AND s.path IS NOT NULL"),
        0,
        "指向被删标签的线要清掉,不能留悬挂 to_id"
    );
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM lines l JOIN points s ON s.id = l.from_id JOIN points t ON t.id = l.to_id WHERE (l.name_id IS NULL OR l.name_id <> 0) AND s.path IS NOT NULL AND l.to_id NOT IN (SELECT id FROM points WHERE path IS NOT NULL)"
        ),
        0,
        "无悬挂关系行"
    );
}

/// ② 删除起点标签:它的出边由外键 CASCADE 清掉;被指向的目标原样保留
#[test]
fn delete_source_cascades_outgoing_edges() {
    let mut c = db();
    let src = segs(&c, &["作者", "丸尾"]);
    let other = ensure(&c, "甲");
    let guo = ensure(&c, "地点轴/国籍");
    set_tag_relation(&mut c, src, guo, "").unwrap();
    set_tag_relation(&mut c, other, guo, "").unwrap();

    delete_subtree(&mut c, src).unwrap();

    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM lines l JOIN points s ON s.id = l.from_id JOIN points t ON t.id = l.to_id WHERE (l.name_id IS NULL OR l.name_id <> 0) AND s.path IS NOT NULL"),
        1,
        "起点的出线随之消失,别的线不受影响"
    );
    assert_eq!(count_relations_to(&c, guo).unwrap(), 1, "目标仍被指向");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM points WHERE path IS NOT NULL AND id={guo}")), 1, "目标仍在");
}

/// ③ gc_orphans:被指向的标签是"有用处的空壳",不得像无关空壳一样被回收(R7)
#[test]
fn gc_orphans_keeps_relation_target() {
    let mut c = db();
    let guo = ensure(&c, "国籍");
    let junk = ensure(&c, "空壳");
    let carrier = ensure(&c, "作者");
    set_tag_relation(&mut c, carrier, guo, "").unwrap();

    gc_orphans(&c).unwrap();

    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM points WHERE path IS NOT NULL AND id={guo}")), 1, "被指向的标签留下");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM points WHERE path IS NOT NULL AND id={junk}")), 0, "无关空壳仍回收");
}

/// ④ 读方审计:插入关系线后笔记的 tags 列 / FTS / 导出全不变。
/// 标签 id 在偏移区间、笔记 id 在原值区间:任何漏掉方向/名字的读方都可能把关系线
/// 当成这条笔记的链接(强变异敏感)。
#[test]
fn relation_edges_do_not_change_note_tags_fts_or_export() {
    let mut c = db();
    let note = notes::create_plain(&mut c, "记录 #甲").unwrap();
    let jia = id_at(&c, "甲");
    let yi = ensure(&c, "乙");
    // v28 起实体 id 统一连号(旧的标签 id 偏移已删):读方靠 `path`/`kind` 分流,不靠 id 区间。
    assert_ne!(jia, note.id, "标签与笔记是两行");
    let tags_before = repos::notes::read_full(&c, note.id).unwrap().unwrap().tags;
    let fts_before: String = c
        .query_row("SELECT paths FROM points_fts WHERE rowid=?1", params![note.id], |r| r.get(0))
        .unwrap();
    // 导出 = 信息流当前筛选结果:关系线属于 乙 自己的出线,只改 乙 的引用列;
    // 这里钉住「这条笔记自己的导出行」逐字段不变(关系线不得混进笔记的引用列表)。
    let note_row = |c: &Connection| {
        notes_export::rows(c)
            .unwrap()
            .into_iter()
            .find(|r| r.id == note.id)
            .expect("笔记在默认筛选结果内")
    };
    let export_before = note_row(&c);

    set_tag_relation(&mut c, yi, jia, "").unwrap(); // 乙 -> 甲

    let tags_after = repos::notes::read_full(&c, note.id).unwrap().unwrap().tags;
    let fts_after: String = c
        .query_row("SELECT paths FROM points_fts WHERE rowid=?1", params![note.id], |r| r.get(0))
        .unwrap();
    assert_eq!(tags_after, vec!["甲".to_string()], "关系线不得混进笔记的 tags 列");
    assert_eq!(tags_before, tags_after, "插入关系线不得改变笔记的 tags 列");
    assert_eq!(fts_before, fts_after, "插入关系线不得改写 FTS 标签列");
    assert_eq!(note_row(&c), export_before, "关系线不得改写笔记自己的导出行");
}

/// ⑤ 逐标签读数与批量事实口径一致:都给出 name 与**线的名字文本**(不取目标名的 md 备注)
#[test]
fn relation_ref_carries_edge_name() {
    let mut c = db();
    let author = ensure(&c, "作者/丸尾");
    let guo = ensure(&c, "[国籍](国别)");
    set_tag_relation(&mut c, author, guo, "国籍").unwrap();

    let out = list_tag_relations(&c, author).unwrap();
    let one = &out[0];
    assert_eq!(one.path, "[国籍](国别)");
    assert_eq!(one.name, "[国籍](国别)", "name 是原始末段名");
    assert_eq!(one.name_text, "国籍", "nameText 取线的名字点,不是目标名的 md 备注");
    assert!(one.name_id.is_some(), "非空线名必须带名字点 id");

    let facts = tag_facts(&c).unwrap();
    assert_eq!(facts.facts.len(), 1);
    assert_eq!(facts.facts[0].tag_id, author);
    assert_eq!(facts.facts[0].relations, out, "批量事实与逐标签读数一致");
}

/// ⑥ 计数与读数的入边方向一致(count_relations_to 只数指向本标签的直接边)
#[test]
fn count_relations_to_counts_direct_incoming() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    let target = ensure(&c, "丙");
    assert_eq!(count_relations_to(&c, target).unwrap(), 0);
    set_tag_relation(&mut c, a, target, "").unwrap();
    set_tag_relation(&mut c, b, target, "").unwrap();
    assert_eq!(count_relations_to(&c, target).unwrap(), 2);
    assert_eq!(count_relations_to(&c, a).unwrap(), 0, "起点自己不算入边");
    assert_eq!(list_tag_relations(&c, target).unwrap().len(), 0, "丙没有出边");
}

/// ⑦ 线身份:`list_tag_relations` 给出每条线自己的 `line_id`,按它删只删那一条。
/// 同对点可有多条线(有名字 + 无名字):派生键 `(to_id, name_id)` 只管得住读数那一刻的库,
/// 按身份删才是稳的。
#[test]
fn line_id_is_the_delete_handle() {
    let mut c = db();
    let from = ensure(&c, "甲");
    let to = ensure(&c, "乙");
    set_tag_relation(&mut c, from, to, "国籍").unwrap();
    let nameless = crate::db::repos::tags::create_line(&mut c, from, to, None).unwrap();

    let out = list_tag_relations(&c, from).unwrap();
    assert_eq!(out.len(), 2, "同对点可有两条线(一条有名字、一条无名字)");
    let named = out.iter().find(|r| r.name_id.is_some()).expect("有名字线在读数里");
    assert_ne!(named.line_id, nameless, "两条线各有自己的 id");
    assert!(out.iter().any(|r| r.line_id == nameless && r.name_id.is_none()), "无名字线的 line_id 也在读数里");

    crate::db::repos::tags::remove_line(&mut c, named.line_id).unwrap();
    let left = list_tag_relations(&c, from).unwrap();
    assert_eq!(left.len(), 1, "只删被指定的那一条");
    assert_eq!(left[0].line_id, nameless, "同对的另一条线保留");
    crate::db::repos::tags::remove_line(&mut c, named.line_id).unwrap();
    assert_eq!(list_tag_relations(&c, from).unwrap().len(), 1, "重复删幂等,不误伤");
}
