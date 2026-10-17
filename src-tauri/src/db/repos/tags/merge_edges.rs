//! 合并时关系线的并集(设计 2026-10-06 §6):把源的关系整棵挪到目标 ——
//! 出线 `源 → X` 变成 `目标 → X`;入线 `Y → 源` 变成 `Y → 目标`。
//! 会变自环或成环的行按 R3 剔除;`INSERT OR IGNORE` 天然去重(R5)。
//! v31 起线名不再是边上的 `remark`,而是 `name_id` 指向的名字点;搬线时整列带上。
use super::relation::reaches;
use rusqlite::{params, Connection};

/// 把 source 的全部非子级线并到 target;返回实际并入的新线数(不含被去重/剔除的)
pub(crate) fn union_edges(
    conn: &Connection,
    source_id: i64,
    target_id: i64,
) -> Result<i64, String> {
    let mut added = 0i64;
    // 出线:源 → Y 迁成 目标 → Y。目标已能沿关系方向走到 Y 时,再加 目标→Y 会成环,剔除。
    let out_sql = "SELECT to_id, name_id FROM lines \
                   WHERE from_id=?1 AND (name_id IS NULL OR name_id <> 0)";
    for (y, name_id) in column(conn, out_sql, source_id)? {
        if y == target_id || reaches(conn, y, target_id).map_err(|e| e.to_string())? {
            continue;
        }
        added += insert(conn, target_id, y, name_id)?;
    }
    // 入线:Y → 源 迁成 Y → 目标。目标本身能到达 Y 时,再加 Y→目标 会成环(Y≠目标已挡自环),剔除。
    let in_sql = "SELECT from_id, name_id FROM lines \
                  WHERE to_id=?1 AND (name_id IS NULL OR name_id <> 0) \
                  AND from_id IN (SELECT id FROM points WHERE path IS NOT NULL)";
    for (y, name_id) in column(conn, in_sql, source_id)? {
        if y == target_id || reaches(conn, target_id, y).map_err(|e| e.to_string())? {
            continue;
        }
        added += insert(conn, y, target_id, name_id)?;
    }
    Ok(added)
}

/// 单行 (id, name_id) 查询:合并时线的名字要跟着搬,不能丢
fn column(conn: &Connection, sql: &str, id: i64) -> Result<Vec<(i64, Option<i64>)>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

/// 插入一条名字线(`name_id` 为 None = 无名字线),返回是否真的新增(重复即 0)。
/// 同名去重(T3.3):同一 `(from, to, name)` 三元组只留一条 —— 显式先查一道,
/// 不单单依赖表达式唯一索引(`moved` 读数也因此与索引是否存在无关),`OR IGNORE` 兵底。
fn insert(conn: &Connection, from: i64, to: i64, name_id: Option<i64>) -> Result<i64, String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM lines
               WHERE from_id = ?1 AND to_id = ?2
                 AND COALESCE(name_id, -1) = COALESCE(?3, -1))",
            params![from, to, name_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        return Ok(0);
    }
    conn.execute(
        "INSERT OR IGNORE INTO lines(from_id, to_id, name_id) \
         VALUES(?1, ?2, ?3)",
        params![from, to, name_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.changes() as i64)
}
