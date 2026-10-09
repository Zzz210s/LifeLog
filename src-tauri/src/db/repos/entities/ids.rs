//! 实体 id 分配(v28 起全库统一命名空间)。
//!
//! 统一元数据后不再有标签 id 偏移区间:所有实体(笔记与标签)连号共享一个序列,
//! 新建时取全表 `MAX(id)+1`。显式分配(而不是靠 rowid 自增)让夹具与生产口径一致。
use rusqlite::Connection;

/// 下一个实体 id:全表 `MAX(id)+1`;空库时从 1 起。
pub fn next_entity_id(conn: &Connection) -> rusqlite::Result<i64> {
    let max: Option<i64> = conn.query_row("SELECT MAX(id) FROM entities", [], |r| r.get(0))?;
    Ok(max.map(|m| m + 1).unwrap_or(1))
}
