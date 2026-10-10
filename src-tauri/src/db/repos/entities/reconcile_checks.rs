//! spec §3.7 ①–⑦ 的命名对账函数与关键计数;SQL 与门控见 [`super::reconcile`]。
use rusqlite::Connection;

use super::reconcile::run_named;

/// spec §3.7 ① `is_cited` 与 `link` 入边一致。
pub fn check_1_is_cited(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "1")
}

/// spec §3.7 ② 缓存 `parent_id` 与 `child` 入边一致。
pub fn check_2_parent_child(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "2")
}

/// spec §3.7 ③ 缓存 `path` 与推导路径一致。
pub fn check_3_path(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "3")
}

/// spec §3.7 ④ 缓存 `depth` 与边推导深度一致。
pub fn check_4_depth(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "4")
}

/// spec §3.7 ⑤ `child` 边入度不超过 1。
pub fn check_5_single_parent(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "5")
}

/// spec §3.7 ⑥ 同父同键唯一(自动合并作用域,P0-2)。
pub fn check_6_sibling_key(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "6")
}

/// spec §3.7 ⑦ id 完整性(非空 / 唯一 / MIN>=1;无合并记录时还要求连号)。
pub fn check_7_id_integrity(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "7")
}

/// 关键计数;`None` = 该表在当前阶段还不存在(阶段 4 删老表后 `tags` 为 `None`)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Counts {
    pub tags: Option<i64>,
    pub entities: Option<i64>,
    pub child: Option<i64>,
    pub tagging: Option<i64>,
    pub relation: Option<i64>,
    pub link: Option<i64>,
}

fn count_where(conn: &Connection, table: &str, filter: &str) -> rusqlite::Result<Option<i64>> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Ok(None);
    }
    conn.query_row(&format!("SELECT COUNT(*) FROM {table} {filter}"), [], |r| {
        r.get(0)
    })
    .map(Some)
}

/// `entities`/`edges` 分 kind 计数,兼带老 `tags` 读数。
pub fn counts(conn: &Connection) -> rusqlite::Result<Counts> {
    Ok(Counts {
        tags: count_where(conn, "tags", "")?,
        entities: count_where(conn, "entities", "")?,
        child: count_where(conn, "edges", "WHERE kind = 'child'")?,
        tagging: count_where(conn, "edges", "WHERE kind = 'tagging'")?,
        relation: count_where(conn, "edges", "WHERE kind = 'relation'")?,
        link: count_where(conn, "edges", "WHERE kind = 'link'")?,
    })
}
