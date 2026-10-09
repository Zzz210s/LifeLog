//! T1.4 自动合并三重闸门(spec §3.6 / §10-P0-3):`is_cited=1` + 两侧 `meta` 单行
//! + 两侧 `meta` 逐字节相等(且同父、`entity_key` 相等)。候选选取(`next_duplicate`)与
//! 日志写入(`write_merge_log`)在 v28 夹具上单独验证;`merge_core` 本体仍按 v27 列名写,
//! 切新表由 T2.2 完成。
use super::*;
use crate::db::migrate;
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn ent(c: &Connection, id: i64, meta: &str, cited: i64, parent: Option<i64>, path: Option<&str>) {
    let depth = path.map(|p| p.matches('/').count() as i64 + 1);
    c.execute(
        "INSERT INTO entities(id, meta, is_cited, created_at, parent_id, path, depth)
         VALUES(?1, ?2, ?3, '2026-01-01T00:00:00.000', ?4, ?5, ?6)",
        params![id, meta, cited, parent, path, depth],
    )
    .unwrap();
}

fn next(c: &Connection) -> Option<(i64, i64)> {
    auto_merge::next_duplicate(c).unwrap()
}

fn text(c: &Connection, sql: &str) -> String {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn auto_merge_picks_byte_equal_cited_single_line_pair() {
    let c = db();
    ent(&c, 1, "工作", 0, None, Some("工作"));
    ent(&c, 2, "项目", 1, Some(1), Some("工作/项目"));
    ent(&c, 3, "项目", 1, Some(1), Some("工作/项目"));
    assert_eq!(next(&c), Some((3, 2)), "保留 id 最小者为目标");

    auto_merge::write_merge_log(&c, 3, 2).unwrap();
    assert_eq!(text(&c, "SELECT meta_snapshot FROM entity_merge_log"), "项目", "被删侧 meta 原文入日志");
    assert_eq!(text(&c, "SELECT source_entity_id || ',' || target_entity_id FROM entity_merge_log"), "3,2");
}

#[test]
fn auto_merge_refuses_multiline_entities() {
    let c = db();
    ent(&c, 1, "工作", 0, None, Some("工作"));
    ent(&c, 2, "项目\n正文一", 1, Some(1), Some("工作/项目"));
    ent(&c, 3, "项目\n正文一", 1, Some(1), Some("工作/项目"));
    assert_eq!(next(&c), None, "多行(有正文)不合并,避免吃掉正文");
}

#[test]
fn auto_merge_refuses_entities_differing_only_by_case() {
    let c = db();
    ent(&c, 1, "工作", 0, None, Some("工作"));
    ent(&c, 2, "Fate/Strange Fake", 1, Some(1), Some("工作/Fate"));
    ent(&c, 3, "fate/strange fake", 1, Some(1), Some("工作/fate"));
    assert_eq!(next(&c), None, "entity_key 相等但 meta 不逐字节相等 -> 不合并");
}

#[test]
fn auto_merge_refuses_uncited_pair() {
    let c = db();
    ent(&c, 1, "工作", 0, None, Some("工作"));
    ent(&c, 2, "项目", 1, Some(1), Some("工作/项目"));
    ent(&c, 3, "项目", 0, Some(1), Some("工作/项目"));
    assert_eq!(next(&c), None, "有 is_cited=0 者不合并");
}
