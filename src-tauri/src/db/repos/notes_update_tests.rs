//! update 测试(测试先行 TDD)
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::{create_plain, notes_filter::*, query};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 简化构造:仅关键词,最新在前
fn f(keyword: Option<&str>) -> FilterConditions {
    FilterConditions { keyword: keyword.map(String::from), ..empty() }
}

/// 断言用:返回标量 COUNT 查询结果
fn count(c: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql]) -> i64 {
    c.query_row(sql, params, |r| r.get(0)).unwrap()
}

#[test]
fn update_replaces_links_and_cleans_orphans() {
    let mut c = db();
    let n = create_plain(&mut c, "旧文 #甲标签").unwrap();
    let upd = update(&mut c, n.id, "新文 #乙标签").unwrap().unwrap();
    // 返回全量 tags 与剥离后正文
    assert_eq!(upd.id, n.id);
    assert_eq!(upd.content, "新文");
    assert_eq!(upd.tags, vec!["乙标签"]);
    // 替换语义:旧链清空、新链生效(该笔记仅剩一条链)
    let links = count(
        &c,
        "SELECT COUNT(*) FROM tag_links WHERE target_type='note' AND target_id=?1",
        &[&n.id],
    );
    assert_eq!(links, 1);
    let old_link = count(
        &c,
        "SELECT COUNT(*) FROM tag_links l JOIN tags t ON t.id = l.tag_id WHERE t.name='甲标签'",
        &[],
    );
    assert_eq!(old_link, 0);
    // 孤儿标签回收:甲标签已无引用即删,乙标签保留
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE name='甲标签'", &[]), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE name='乙标签'", &[]), 1);
}

#[test]
fn update_keeps_tag_shared_with_other_note() {
    let mut c = db();
    let a = create_plain(&mut c, "a #共用").unwrap();
    create_plain(&mut c, "b #共用").unwrap();
    update(&mut c, a.id, "改了 #别的").unwrap();
    // 共用标签仍被 b 引用,孤儿清理不得误删
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE name='共用'", &[]), 1);
    let b_links = count(
        &c,
        "SELECT COUNT(*) FROM tag_links l JOIN tags t ON t.id = l.tag_id WHERE t.name='共用'",
        &[],
    );
    assert_eq!(b_links, 1);
}

#[test]
fn update_returns_none_for_missing_id() {
    let mut c = db();
    create_plain(&mut c, "存在 #x").unwrap();
    assert!(update(&mut c, 9999, "不存在 #y").unwrap().is_none());
}

#[test]
fn update_writes_content_without_updating_time_columns() {
    let mut c = db();
    let n = create_plain(&mut c, "旧正文 #甲").unwrap();
    let created: String = c
        .query_row("SELECT created_at FROM notes WHERE id=?1", [n.id], |r| r.get(0))
        .unwrap();
    let upd = update(&mut c, n.id, "新正文 #乙").unwrap().unwrap();
    assert_eq!(upd.content, "新正文");
    assert_eq!(upd.tags, vec!["乙"]);
    // S3:updated_at 列已删除;created_at 是创建时间、不是“最后修改”的替身,必须原样
    let after: String = c
        .query_row("SELECT created_at FROM notes WHERE id=?1", [n.id], |r| r.get(0))
        .unwrap();
    assert_eq!(after, created);
}

#[test]
fn update_keeps_fts_in_sync() {
    let mut c = db();
    let n = create_plain(&mut c, "旧正文 #甲标签").unwrap();
    update(&mut c, n.id, "新正文 #乙标签").unwrap().unwrap();
    // 新词可检索(正文列)
    assert_eq!(query(&c, &f(Some("新正文")), 0).unwrap().len(), 1);
    // 旧词不再命中
    assert!(query(&c, &f(Some("旧正文")), 0).unwrap().is_empty());
    // tags 列聚合同步:新标签可检索、旧标签不残留
    assert_eq!(query(&c, &f(Some("乙标签")), 0).unwrap().len(), 1);
    assert!(query(&c, &f(Some("甲标签")), 0).unwrap().is_empty());
}

