//! update/toggle_todo 测试(测试先行 TDD)
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::{create, notes_filter::*, query};
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
    let n = create(&mut c, "旧文 #甲标签").unwrap();
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
    let a = create(&mut c, "a #共用").unwrap();
    create(&mut c, "b #共用").unwrap();
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
    create(&mut c, "存在 #x").unwrap();
    assert!(update(&mut c, 9999, "不存在 #y").unwrap().is_none());
}

#[test]
fn update_writes_content_and_bumps_updated_at() {
    let mut c = db();
    let n = create(&mut c, "旧正文 #甲").unwrap();
    // 手工回拨 updated_at 避免同秒分辨率掩盖变化
    c.execute("UPDATE notes SET updated_at='2000-01-01 00:00:00' WHERE id=?1", [n.id])
        .unwrap();
    let upd = update(&mut c, n.id, "新正文 #乙").unwrap().unwrap();
    assert_eq!(upd.content, "新正文");
    let updated_at: String = c
        .query_row("SELECT updated_at FROM notes WHERE id=?1", [n.id], |r| r.get(0))
        .unwrap();
    assert_ne!(updated_at, "2000-01-01 00:00:00");
    assert!(!updated_at.is_empty());
}

#[test]
fn update_keeps_fts_in_sync() {
    let mut c = db();
    let n = create(&mut c, "旧正文 #甲标签").unwrap();
    update(&mut c, n.id, "新正文 #乙标签").unwrap().unwrap();
    // 新词可检索(正文列)
    assert_eq!(query(&c, &f(Some("新正文")), 0).unwrap().len(), 1);
    // 旧词不再命中
    assert!(query(&c, &f(Some("旧正文")), 0).unwrap().is_empty());
    // tags 列聚合同步:新标签可检索、旧标签不残留
    assert_eq!(query(&c, &f(Some("乙标签")), 0).unwrap().len(), 1);
    assert!(query(&c, &f(Some("甲标签")), 0).unwrap().is_empty());
}

#[test]
fn toggle_todo_swaps_to_done_with_content_intact() {
    let mut c = db();
    let n = create(&mut c, "买牛奶 #todo").unwrap();
    let t = toggle_todo(&mut c, n.id).unwrap().unwrap();
    assert_eq!(t.id, n.id);
    assert_eq!(t.content, "买牛奶"); // 正文不动,仅标签集合切换
    assert_eq!(t.tags, vec!["done"]);
    // 库内链接同样切换
    let done_link = count(
        &c,
        "SELECT COUNT(*) FROM tag_links l JOIN tags t ON t.id = l.tag_id WHERE t.name='done' AND l.target_id=?1",
        &[&n.id],
    );
    assert_eq!(done_link, 1);
    let todo_link = count(
        &c,
        "SELECT COUNT(*) FROM tag_links l JOIN tags t ON t.id = l.tag_id WHERE t.name='todo' AND l.target_id=?1",
        &[&n.id],
    );
    assert_eq!(todo_link, 0);
}

#[test]
fn toggle_todo_swaps_done_back_to_todo() {
    let mut c = db();
    let n = create(&mut c, "已完成事项 #done").unwrap();
    let t = toggle_todo(&mut c, n.id).unwrap().unwrap();
    assert_eq!(t.tags, vec!["todo"]);
    assert_eq!(t.content, "已完成事项");
}

#[test]
fn toggle_todo_untagged_note_unchanged() {
    let mut c = db();
    let n = create(&mut c, "普通 #随笔").unwrap();
    c.execute("UPDATE notes SET updated_at='2000-01-01 00:00:00' WHERE id=?1", [n.id])
        .unwrap();
    let t = toggle_todo(&mut c, n.id).unwrap().unwrap();
    assert_eq!(t.id, n.id);
    assert_eq!(t.content, "普通");
    assert_eq!(t.tags, vec!["随笔"]); // 其余标签原样保留
    // 无 todo/done 时不做任何写操作:updated_at 不被刷新
    let updated_at: String = c
        .query_row("SELECT updated_at FROM notes WHERE id=?1", [n.id], |r| r.get(0))
        .unwrap();
    assert_eq!(updated_at, "2000-01-01 00:00:00");
}

#[test]
fn toggle_todo_missing_returns_none() {
    let mut c = db();
    create(&mut c, "存在").unwrap();
    assert!(toggle_todo(&mut c, 9999).unwrap().is_none());
}

#[test]
fn toggle_todo_keeps_fts_in_sync() {
    let mut c = db();
    let n = create(&mut c, "#todo 任务一").unwrap();
    toggle_todo(&mut c, n.id).unwrap().unwrap();
    // 切到 done 后:done 可检索、todo 不再命中(tags 列聚合)
    assert_eq!(query(&c, &f(Some("done")), 0).unwrap().len(), 1);
    assert!(query(&c, &f(Some("todo")), 0).unwrap().is_empty());
    // 再切回 todo,双向同步
    toggle_todo(&mut c, n.id).unwrap().unwrap();
    assert_eq!(query(&c, &f(Some("todo")), 0).unwrap().len(), 1);
    assert!(query(&c, &f(Some("done")), 0).unwrap().is_empty());
}
