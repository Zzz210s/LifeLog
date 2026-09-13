//! notes 流查询层(自 notes.rs 拆出以守 200 行上限):条件化 query + count_matching + count_tags
use super::notes_filter::{order_clause, where_clause, FilterConditions};
use super::{fold_tag_rows, map_note_row, Note};
use rusqlite::{params_from_iter, types::Value, Connection};

/// 每页条数(与前端分页常量 `PAGE` 一致);分页只由 offset 驱动
pub const PAGE_SIZE: i64 = 50;

/// 按条件查询笔记流(offset 为行偏移):
/// - 条件 -> SQL 片段全部由 [`where_clause`] 生成(标签 substr 前缀 + 参数占位,无 LIKE 通配符)
/// - 关键词 >=3 字符走 FTS MATCH,否则退化 LIKE(既有行为,仅关键词可用)
/// - 分页排序在 id 子查询内完成,外层仅做标签行折叠
pub fn query(
    conn: &Connection,
    conditions: &FilterConditions,
    offset: i64,
) -> Result<Vec<Note>, String> {
    let (frag, mut args) = where_clause(conditions);
    let dir = order_clause(conditions);
    let sql = format!(
        "SELECT n.id, n.content, n.created_at, t.path
         FROM notes n
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         WHERE n.id IN (SELECT n.id FROM notes n WHERE {frag} ORDER BY {dir} LIMIT {PAGE_SIZE} OFFSET ?)
         ORDER BY {dir}, t.path"
    );
    args.push(Value::Integer(offset.max(0)));
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(args), map_note_row)
        .map_err(|e| e.to_string())?;
    fold_tag_rows(rows).map_err(|e| e.to_string())
}

/// 当前条件命中的总条数(供侧栏视图徽标使用;MVP-3 3b 起接入命令层)
#[allow(dead_code)]
pub fn count_matching(conn: &Connection, conditions: &FilterConditions) -> rusqlite::Result<i64> {
    let (frag, args) = where_clause(conditions);
    conn.query_row(
        &format!("SELECT COUNT(*) FROM notes n WHERE {frag}"),
        params_from_iter(args),
        |r| r.get(0),
    )
}

/// 标签使用计数(仅统计 note 链接)返回**完整路径**:按次数降序,同数按路径升序。
/// 查询失败静默吞为空表(unwrap_or_default):筛选栏拿不到数据不阻断主界面,代价是错误被掩盖。
pub fn count_tags(conn: &Connection) -> Vec<(String, i64)> {
    conn.prepare(
        "SELECT t.path, COUNT(*) FROM tag_links l JOIN tags t ON t.id = l.tag_id
         WHERE l.target_type = 'note' GROUP BY t.path ORDER BY COUNT(*) DESC, t.path",
    )
    .and_then(|mut stmt| {
        let rows =
            stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
    .unwrap_or_default()
}

#[cfg(test)]
#[path = "notes_query_tests.rs"]
mod notes_query_tests;

#[cfg(test)]
#[path = "notes_query_conds_tests.rs"]
mod notes_query_conds_tests;
