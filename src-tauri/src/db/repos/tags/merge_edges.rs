//! 合并时关系边的并集(设计 2026-10-06 §6):把源的关系整棵挪到目标 ——
//! 出边 `源 → X` 变成 `目标 → X`;入边 `Y → 源` 变成 `Y → 目标`。
//! 会变自环或成环的行按 R3 剔除;`INSERT OR IGNORE` 天然去重(R5)。
use super::relation::reaches;
use rusqlite::{params, Connection};

/// 把 source 的全部关系边并到 target;返回实际并入的新边数(不含被去重/剔除的)
pub(crate) fn union_edges(
    conn: &Connection,
    source_id: i64,
    target_id: i64,
) -> Result<i64, String> {
    let mut added = 0i64;
    // 出边:源 → Y 迁成 目标 → Y。目标已能沿关系方向走到 Y 时,再加 目标→Y 会成环,剔除。
    for y in column(conn, "SELECT target_id FROM tag_links WHERE tag_id=?1 AND target_type='tag'", source_id)? {
        if y == target_id || reaches(conn, y, target_id).map_err(|e| e.to_string())? {
            continue;
        }
        added += insert(conn, target_id, y)?;
    }
    // 入边:Y → 源 迁成 Y → 目标。目标本身能到达 Y 时,再加 Y→目标 会成环(Y≠目标已挡自环),剔除。
    for y in column(conn, "SELECT tag_id FROM tag_links WHERE target_id=?1 AND target_type='tag'", source_id)? {
        if y == target_id || reaches(conn, target_id, y).map_err(|e| e.to_string())? {
            continue;
        }
        added += insert(conn, y, target_id)?;
    }
    Ok(added)
}

/// 单列 i64 查询
fn column(conn: &Connection, sql: &str, id: i64) -> Result<Vec<i64>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![id], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

/// 插入一条关系边,返回是否真的新增(重复即 0)
fn insert(conn: &Connection, from: i64, to: i64) -> Result<i64, String> {
    conn.execute(
        "INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'tag', ?2)",
        params![from, to],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.changes() as i64)
}
