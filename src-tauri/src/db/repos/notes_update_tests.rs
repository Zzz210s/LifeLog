//! update 测试(测试先行 TDD)
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::{create_plain, notes_filter::*, query};
use crate::db::repos::tags::invariants_tests::{assert_fts_matches_tags, assert_no_orphan_tags};
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
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
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
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

#[test]
fn update_returns_none_for_missing_id() {
    let mut c = db();
    create_plain(&mut c, "存在 #x").unwrap();
    assert!(update(&mut c, 9999, "不存在 #y").unwrap().is_none());
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
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
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// 一条笔记的链接行 `(target_id, raw_title)`,按 raw_title 升序
fn link_rows(c: &Connection, id: i64) -> Vec<(Option<i64>, String)> {
    c.prepare("SELECT target_id, raw_title FROM note_links WHERE source_id=?1 ORDER BY raw_title")
        .unwrap()
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn update_writes_links_and_tags_in_one_transaction() {
    let mut c = db();
    let target = create_plain(&mut c, "目标笔记\n#日记").unwrap();
    let src = create_plain(&mut c, "源 #甲").unwrap();
    update(&mut c, src.id, "源 [[目标笔记]] #乙").unwrap().unwrap();
    assert_eq!(link_rows(&c, src.id), vec![(Some(target.id), "目标笔记".to_string())],
        "同一次保存里标签与链接都落地");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE name='甲'", &[]), 0, "标签替换语义照旧");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE name='乙'", &[]), 1);
}

#[test]
fn update_clears_links_when_body_drops_them() {
    let mut c = db();
    create_plain(&mut c, "目标笔记").unwrap();
    let src = create_plain(&mut c, "源").unwrap();
    update(&mut c, src.id, "源 [[目标笔记]]").unwrap().unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM note_links WHERE source_id=?1", &[&src.id]), 1);
    update(&mut c, src.id, "源 改了,不再提它").unwrap().unwrap();
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM note_links WHERE source_id=?1", &[&src.id]),
        0,
        "替换语义:正文里去掉链接后 note_links 整批清空"
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM note_links", &[]), 0);
}

#[test]
fn update_missing_id_writes_no_links() {
    let mut c = db();
    create_plain(&mut c, "甲").unwrap();
    assert!(update(&mut c, 9999, "正文 [[甲]]").unwrap().is_none());
    assert_eq!(count(&c, "SELECT COUNT(*) FROM note_links", &[]), 0, "回滚的 tx 不留下链接行");
}

#[test]
fn tag_shaped_link_title_produces_no_link() {
    let mut c = db();
    let src = create_plain(&mut c, "源").unwrap();
    update(&mut c, src.id, "参考 [[#甲]]").unwrap().unwrap();
    // 扫的是剥标签后的正文:此处已是 `参考 [[]]`,不产生链接(设计 §5 边界 5);
    // 而 `#甲` 仍是普通标签(标签语法只认 `#`,与链接互不干扰)
    assert_eq!(count(&c, "SELECT COUNT(*) FROM note_links", &[]), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE name='甲'", &[]), 1);
}

