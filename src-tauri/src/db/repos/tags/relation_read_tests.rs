//! 标签关系的读方审计(设计 2026-10-06 §10 R8 / 计划 Task 1 §6):
//! 收成两态后逐项复查 —— 删除标签显式清边、gc_orphans 保护"被指向"的标签、
//! 关系边不进 FTS / 不进导出 / 不改笔记 tags 列;备注只来自名字里的 md 备注(仅显示)。
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
    c.query_row("SELECT id FROM tags WHERE path=?1", params![path], |r| r.get(0)).unwrap()
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// ① 删除被指向的标签:指向它的边必须被显式清掉(target_id 上没有外键)
#[test]
fn delete_target_cleans_incoming_edges() {
    let mut c = db();
    let jia = ensure(&c, "甲");
    let target = segs(&c, &["地点轴", "国籍"]);
    set_tag_relation(&mut c, jia, target).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='tag'"), 1);

    let root = id_at(&c, "地点轴");
    delete_subtree(&mut c, root).unwrap();

    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='tag'"),
        0,
        "指向被删标签的边要清掉,不能留悬空 target_id"
    );
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM tag_links WHERE target_type='tag' \
             AND target_id NOT IN (SELECT id FROM tags)"
        ),
        0,
        "无悬空关系行"
    );
}

/// ② 删除起点标签:它的出边由外键 CASCADE 清掉;被指向的目标原样保留
#[test]
fn delete_source_cascades_outgoing_edges() {
    let mut c = db();
    let src = segs(&c, &["作者", "丸尾"]);
    let other = ensure(&c, "甲");
    let guo = ensure(&c, "地点轴/国籍");
    set_tag_relation(&mut c, src, guo).unwrap();
    set_tag_relation(&mut c, other, guo).unwrap();

    delete_subtree(&mut c, src).unwrap();

    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='tag'"),
        1,
        "起点的出边随之消失,别的边不受影响"
    );
    assert_eq!(count_relations_to(&c, guo).unwrap(), 1, "目标仍被指向");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={guo}")), 1, "目标仍在");
}

/// ③ gc_orphans:被指向的标签是"有用处的空壳",不得像无关空壳一样被回收(R7)
#[test]
fn gc_orphans_keeps_relation_target() {
    let mut c = db();
    let guo = ensure(&c, "国籍");
    let junk = ensure(&c, "空壳");
    let carrier = ensure(&c, "作者");
    set_tag_relation(&mut c, carrier, guo).unwrap();

    gc_orphans(&c).unwrap();

    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={guo}")), 1, "被指向的标签留下");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={junk}")), 0, "无关空壳仍回收");
}

/// ④ 读方审计:插入关系边后笔记的 tags 列 / FTS / 导出全不变。
/// 刻意让**目标标签 id 等于这条笔记 id**(首个标签与首条笔记都拿 id 1):
/// 任何漏掉 `target_type='note'` 的读方都会把关系边当成这条笔记的链接(强变异敏感)。
#[test]
fn relation_edges_do_not_change_note_tags_fts_or_export() {
    let mut c = db();
    let note = notes::create_plain(&mut c, "记录 #甲").unwrap();
    let jia = id_at(&c, "甲");
    let yi = ensure(&c, "乙");
    assert_eq!(jia, note.id, "测试前提:首个标签与首条笔记都拿到 id 1");
    let tags_before = repos::notes::read_full(&c, note.id).unwrap().unwrap().tags;
    let fts_before: String = c
        .query_row("SELECT tags FROM notes_fts WHERE rowid=?1", params![note.id], |r| r.get(0))
        .unwrap();
    let export_before = notes_export::rows(&c).unwrap();

    set_tag_relation(&mut c, yi, jia).unwrap(); // 乙 -> 甲(target_id = note.id,故意撞号)

    let tags_after = repos::notes::read_full(&c, note.id).unwrap().unwrap().tags;
    let fts_after: String = c
        .query_row("SELECT tags FROM notes_fts WHERE rowid=?1", params![note.id], |r| r.get(0))
        .unwrap();
    assert_eq!(tags_after, vec!["甲".to_string()], "关系边不得混进笔记的 tags 列");
    assert_eq!(tags_before, tags_after, "插入关系边不得改变笔记的 tags 列");
    assert_eq!(fts_before, fts_after, "插入关系边不得改写 FTS 标签列");
    assert_eq!(notes_export::rows(&c).unwrap(), export_before, "导出内容不因关系而变");
}

/// ⑤ 逐标签读数与批量事实口径一致:都给出 name 与 md 备注(备注只来自被指向标签的名字)
#[test]
fn relation_ref_carries_name_and_md_remark() {
    let mut c = db();
    let author = ensure(&c, "作者/丸尾");
    let guo = ensure(&c, "[国籍](国别)");
    set_tag_relation(&mut c, author, guo).unwrap();

    let out = list_tag_relations(&c, author).unwrap();
    let one = &out[0];
    assert_eq!(one.path, "[国籍](国别)");
    assert_eq!(one.name, "[国籍](国别)", "name 是原始末段名");
    assert_eq!(one.remark, "国别", "remark 取名字里的链接备注");

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
    set_tag_relation(&mut c, a, target).unwrap();
    set_tag_relation(&mut c, b, target).unwrap();
    assert_eq!(count_relations_to(&c, target).unwrap(), 2);
    assert_eq!(count_relations_to(&c, a).unwrap(), 0, "起点自己不算入边");
    assert_eq!(list_tag_relations(&c, target).unwrap().len(), 0, "丙没有出边");
}
