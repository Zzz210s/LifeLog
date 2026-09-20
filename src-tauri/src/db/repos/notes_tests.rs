//! notes 仓储既有行为测试(create/recent/delete),自 notes.rs 拆出以守 200 行上限
use super::*;
use crate::db::migrate;
use crate::db::repos::tags_invariants_tests::{assert_fts_matches_tags, assert_no_orphan_tags};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 断言用:返回标量 COUNT 查询结果
fn count(c: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql]) -> i64 {
    c.query_row(sql, params, |r| r.get(0)).unwrap()
}

#[test]
fn create_parses_tags_and_links() {
    let mut c = db();
    let n = create_plain(&mut c, "看完了 #流浪地球 #科幻").unwrap();
    assert_eq!(n.tags, vec!["流浪地球", "科幻"]);
    let links = count(&c, "SELECT COUNT(*) FROM tag_links", &[]);
    assert_eq!(links, 2);
}

#[test]
fn tags_reused_across_notes() {
    let mut c = db();
    create_plain(&mut c, "a #x").unwrap();
    create_plain(&mut c, "b #x").unwrap();
    let tags = count(&c, "SELECT COUNT(*) FROM tags WHERE name='x'", &[]);
    assert_eq!(tags, 1);
}

#[test]
fn recent_orders_desc_with_tags() {
    let mut c = db();
    create_plain(&mut c, "one #t1").unwrap();
    create_plain(&mut c, "two #t2").unwrap();
    let list = recent(&c, 20).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].content, "two");
    assert_eq!(list[0].tags, vec!["t2"]);
    assert_eq!(list[1].tags, vec!["t1"]);
}

#[test]
fn create_strips_tags_without_prefix_collision() {
    let mut c = db();
    let n = create_plain(&mut c, "看完了 #书 想买 #书评").unwrap();
    assert_eq!(n.content, "看完了 想买");
    assert_eq!(n.tags, vec!["书", "书评"]);
}

#[test]
fn create_preserves_multiline_structure() {
    let mut c = db();
    let n = create_plain(&mut c, "第一行 #tag\n第二行\n\n第三段").unwrap();
    assert_eq!(n.content, "第一行\n第二行\n\n第三段");
    assert_eq!(n.tags, vec!["tag"]);
    // CRLF 输入归一为 LF,行结构同样保留
    let n2 = create_plain(&mut c, "第一行 #tag\r\n第二行\r\n\r\n第三段").unwrap();
    assert_eq!(n2.content, "第一行\n第二行\n\n第三段");
    assert_eq!(n2.tags, vec!["tag"]);
}

#[test]
fn recent_limit_counts_notes_not_rows() {
    let mut c = db();
    create_plain(&mut c, "one #t1").unwrap();
    create_plain(&mut c, "two #t2 #t3").unwrap();
    create_plain(&mut c, "three #t4").unwrap();
    let list = recent(&c, 2).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].content, "three");
    assert_eq!(list[1].content, "two");
    assert_eq!(list[1].tags, vec!["t2", "t3"]);
}

#[test]
fn delete_removes_note_links_and_orphan_tags() {
    let mut c = db();
    let n = create_plain(&mut c, "a #孤儿").unwrap();
    create_plain(&mut c, "b #共用").unwrap();
    delete(&mut c, n.id).unwrap();
    let notes = count(&c, "SELECT COUNT(*) FROM notes", &[]);
    assert_eq!(notes, 1);
    let links = count(
        &c,
        "SELECT COUNT(*) FROM tag_links WHERE target_type='note' AND target_id=?1",
        &[&n.id],
    );
    assert_eq!(links, 0);
    let orphan = count(&c, "SELECT COUNT(*) FROM tags WHERE name='孤儿'", &[]);
    assert_eq!(orphan, 0);
    let kept = count(&c, "SELECT COUNT(*) FROM tags WHERE name='共用'", &[]);
    assert_eq!(kept, 1);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

#[test]
fn delete_also_cleans_fts_row() {
    let mut c = db();
    let n = create_plain(&mut c, "要删的 #测试").unwrap();
    delete(&mut c, n.id).unwrap();
    let fts = count(&c, "SELECT COUNT(*) FROM notes_fts", &[]);
    assert_eq!(fts, 0);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}
