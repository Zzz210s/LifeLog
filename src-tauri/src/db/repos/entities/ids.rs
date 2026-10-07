//! 老 `tags.id` 与标签实体 id 的换算集中处(spec §12 D1)。
//!
//! 标签实体 id 一律落在 `[TAG_ID_OFFSET, …)`,与笔记 id 区间永久不撞。生产库的标签实体
//! 由迁移 024 按 `tags.id + TAG_ID_OFFSET` 建好;此后新建标签的 id 也由本模块分配,
//! 避免把 `+1000000000` 散落到写路径各处(计划 T4.1)。
use rusqlite::Connection;

use super::TAG_ID_OFFSET;

/// 老 `tags.id` -> 标签实体 id
pub const fn to_entity(tag_id: i64) -> i64 {
    tag_id + TAG_ID_OFFSET
}

/// 标签实体 id -> 老 `tags.id`(仅迁移/兼容层回译用)
pub const fn to_legacy(entity_id: i64) -> i64 {
    entity_id - TAG_ID_OFFSET
}

/// 该实体 id 是否落在标签实体区间
pub const fn is_tag_entity(entity_id: i64) -> bool {
    entity_id >= TAG_ID_OFFSET
}

/// 下一个标签实体 id:标签区间内 `MAX(id)+1`;空库时取区间下界。
/// 显式分配(而不是靠 rowid 自增)是为了让「标签 id 落在偏移区间」在夹具里也成立 ——
/// 夹具只有标签实体时自增会从 1 开始,与笔记实体 id 相撞。
pub fn next_tag_id(conn: &Connection) -> rusqlite::Result<i64> {
    let max: Option<i64> = conn.query_row(
        "SELECT MAX(id) FROM entities WHERE kind='tag'",
        [],
        |r| r.get(0),
    )?;
    Ok(max.map(|m| m + 1).unwrap_or(TAG_ID_OFFSET))
}
