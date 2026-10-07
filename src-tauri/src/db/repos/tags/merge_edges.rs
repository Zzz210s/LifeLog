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
    let out_sql =
        "SELECT target_id, remark FROM edges WHERE source_id=?1 AND kind='relation'";
    for (y, remark) in column(conn, out_sql, source_id)? {
        if y == target_id || reaches(conn, y, target_id).map_err(|e| e.to_string())? {
            continue;
        }
        added += insert(conn, target_id, y, &remark)?;
    }
    // 入边:Y → 源 迁成 Y → 目标。目标本身能到达 Y 时,再加 Y→目标 会成环(Y≠目标已挡自环),剔除。
    let in_sql = "SELECT source_id, remark FROM edges WHERE target_id=?1 AND kind='relation'";
    for (y, remark) in column(conn, in_sql, source_id)? {
        if y == target_id || reaches(conn, target_id, y).map_err(|e| e.to_string())? {
            continue;
        }
        added += insert(conn, y, target_id, &remark)?;
    }
    Ok(added)
}

/// 单列 (id, 属性名) 查询:合并时边的属性名要跟着搬,不能丢
fn column(conn: &Connection, sql: &str, id: i64) -> Result<Vec<(i64, String)>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

/// 插入一条关系边(带属性名),返回是否真的新增(重复即 0)
fn insert(conn: &Connection, from: i64, to: i64, remark: &str) -> Result<i64, String> {
    conn.execute(
        "INSERT OR IGNORE INTO edges(source_id, target_id, kind, remark, created_at) \
         VALUES(?1, ?2, 'relation', ?3, datetime('now', 'localtime'))",
        params![from, to, remark],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.changes() as i64)
}
