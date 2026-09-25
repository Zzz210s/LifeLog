//! notes 流查询层(自 notes.rs 拆出以守 200 行上限):条件化 query + count_matching
//! (旧标签板的 count_tags 已随标签板移除而清理)
use super::notes_filter::{oldest_first, where_clause, FilterConditions};
use super::{fold_tag_rows, map_note_row, Note};
use rusqlite::{params_from_iter, types::Value, Connection};

/// 每页条数(与前端分页常量 `PAGE` 一致);分页只由 offset 驱动
pub const PAGE_SIZE: i64 = 50;

/// 排序片段(D1:只按 `notes.id` —— 它与 created_at 同序,而日期不再参与排序):
/// 最新在前 = id DESC / 最早在前 = id ASC。
fn order_dir(oldest: bool) -> &'static str {
    if oldest {
        "ASC"
    } else {
        "DESC"
    }
}

/// 按条件查询笔记流(offset 为行偏移):
/// - 条件 -> SQL 片段全部由 [`where_clause`] 生成(标签 substr 前缀 + 参数占位,无 LIKE 通配符)
/// - 关键词 >=3 字符走 FTS MATCH,否则退化 LIKE(既有行为,仅关键词可用)
/// - 分页排序在 `page` CTE 内完成(按 id),外层仅做标签行折叠
pub fn query(
    conn: &Connection,
    conditions: &FilterConditions,
    offset: i64,
) -> Result<Vec<Note>, String> {
    let (frag, mut args) = where_clause(conditions)?;
    let dir = order_dir(oldest_first(conditions));
    let sql = format!(
        "WITH page AS (
           SELECT n.id AS id FROM notes n WHERE {frag}
           ORDER BY n.id {dir}
           LIMIT {PAGE_SIZE} OFFSET ?
         )
         SELECT n.id, n.content, n.created_at, t.path
         FROM page p
         JOIN notes n ON n.id = p.id
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         ORDER BY n.id {dir}, t.path"
    );
    args.push(Value::Integer(offset.max(0)));
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(args), map_note_row)
        .map_err(|e| e.to_string())?;
    fold_tag_rows(rows).map_err(|e| e.to_string())
}

/// 当前条件命中的总条数:**仅供测试使用**。视图模块已删(S6),也不再有每页分录计数
/// 徽标(N 页 N 次 COUNT 的代价不合理,当前页的计数由流头部照旧显示),故生产路径不再有调用方。
/// 错误类型与 [`query`] 一致("条件非法" 用中文原因而不是 rusqlite 的英文错误)。
#[cfg(test)]
pub fn count_matching(conn: &Connection, conditions: &FilterConditions) -> Result<i64, String> {
    let (frag, args) = where_clause(conditions)?;
    conn.query_row(
        &format!("SELECT COUNT(*) FROM notes n WHERE {frag}"),
        params_from_iter(args),
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "notes_query_tests.rs"]
mod notes_query_tests;

#[cfg(test)]
#[path = "notes_query_conds_tests.rs"]
mod notes_query_conds_tests;

#[cfg(test)]
#[path = "notes_query_expr_tests.rs"]
mod notes_query_expr_tests;

#[cfg(test)]
#[path = "notes_query_time_tests.rs"]
mod notes_query_time_tests;

#[cfg(test)]
#[path = "notes_query_coarse_tests.rs"]
mod notes_query_coarse_tests;
