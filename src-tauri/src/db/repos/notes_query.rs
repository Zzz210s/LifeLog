//! notes 流查询层(自 notes.rs 拆出以守 200 行上限):条件化 query + count_matching
//! (旧标签板的 count_tags 已随标签板移除而清理)
use super::notes_filter::{oldest_first, where_clause, FilterConditions};
use super::{fold_tag_rows, map_note_row, Note};
use rusqlite::{params_from_iter, types::Value, Connection};

/// 每页条数(与前端分页常量 `PAGE` 一致);分页只由 offset 驱动
pub const PAGE_SIZE: i64 = 50;

/// 排序片段(D2:排序不再看 created_at):
/// - 分页内层按时间标签路径(最新在前 = DESC / 最早在前 = ASC),同日或无标签用 id 兜底,
///   无时间标签者一律排末尾(回填后不应出现);MAX(...) 对同一笔记的多个标签行取时间标签。
/// - 外层沿用同一顺序(结果已被内层裁成单页,重排序只为稳定输出)。
fn orders(oldest: bool) -> (String, String) {
    let dir = if oldest { "ASC" } else { "DESC" };
    (
        format!("(MAX(tt.path) IS NULL), MAX(tt.path) {dir}, n.id {dir}"),
        format!("(p.tpath IS NULL), p.tpath {dir}, p.id {dir}"),
    )
}

/// 按条件查询笔记流(offset 为行偏移):
/// - 条件 -> SQL 片段全部由 [`where_clause`] 生成(标签 substr 前缀 + 参数占位,无 LIKE 通配符)
/// - 关键词 >=3 字符走 FTS MATCH,否则退化 LIKE(既有行为,仅关键词可用)
/// - 分页排序在 `page` CTE 内完成(时间标签路径 + id),外层仅做标签行折叠
pub fn query(
    conn: &Connection,
    conditions: &FilterConditions,
    offset: i64,
) -> Result<Vec<Note>, String> {
    let (frag, mut args) = where_clause(conditions);
    let (page_dir, out_dir) = orders(oldest_first(conditions));
    let time_pred = crate::timetag::sql_is_time_path("tt");
    let sql = format!(
        "WITH page AS (
           SELECT n.id AS id, MAX(tt.path) AS tpath, MAX(tt.id) AS tid
           FROM notes n
           LEFT JOIN tag_links tl ON tl.target_type = 'note' AND tl.target_id = n.id
           LEFT JOIN tags tt ON tt.id = tl.tag_id AND {time_pred}
           WHERE {frag}
           GROUP BY n.id
           ORDER BY {page_dir}
           LIMIT {PAGE_SIZE} OFFSET ?
         )
         SELECT n.id, n.content, n.created_at, t.path, p.tpath, p.tid
         FROM page p
         JOIN notes n ON n.id = p.id
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         ORDER BY {out_dir}, t.path"
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

#[cfg(test)]
#[path = "notes_query_tests.rs"]
mod notes_query_tests;

#[cfg(test)]
#[path = "notes_query_conds_tests.rs"]
mod notes_query_conds_tests;

#[cfg(test)]
#[path = "notes_query_time_tests.rs"]
mod notes_query_time_tests;
