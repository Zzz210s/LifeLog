//! notes 流查询层(自 notes.rs 拆出以守 200 行上限):条件化 query + count_matching
//! (旧标签板的 count_tags 已随标签板移除而清理)。
//! 分页/排序/折叠的公共件抽到 [`notes_page`](super::notes_page),分组查询复用同一份。
use super::notes_filter::{where_clause, FilterConditions};
use super::notes_page;
pub use super::notes_page::PAGE_SIZE;
use super::notes_sort::effective_sorts;
use super::tag_order;
use super::Note;
use rusqlite::{types::Value, Connection};

/// 按条件查询笔记流(offset 为行偏移):
/// - 条件 -> SQL 片段全部由 [`where_clause`] 生成(标签 substr 前缀 + 参数占位,无 LIKE 通配符)
/// - 排序由 `effective_sorts` 生成多键 ORDER BY(标签轴 + 无值沉底 + `n.id` 兜底)
/// - 分页排序在 `page` CTE 内完成,外层照同一键序折叠标签行
pub fn query(
    conn: &Connection,
    conditions: &FilterConditions,
    offset: i64,
) -> Result<Vec<Note>, String> {
    let mut args: Vec<Value> = Vec::new();
    // 排序 CTE 的参数必须先于 where 参数压入(位置 = SQL 文本出现顺序)
    let order = notes_page::build_order(&effective_sorts(conditions), &mut args);
    let (frag, where_args) = where_clause(conditions)?;
    args.extend(where_args);
    args.push(Value::Integer(offset.max(0)));
    let mut ctes: Vec<String> = Vec::new();
    // 树序键 ord 是所有 axis CTE 的前置;无标签轴排序时不需要(见 tag_order::ORD_BODY)
    if !order.ctes.is_empty() {
        ctes.push(tag_order::ORD_BODY.to_string());
    }
    ctes.extend(order.ctes);
    let page_body = format!(
        "page AS (
           SELECT n.id AS id{}
           FROM entities n{}
           WHERE n.kind='note' AND ({frag})
           ORDER BY {}
           LIMIT {PAGE_SIZE} OFFSET ?
         )",
        order.page_cols, order.joins, order.inner
    );
    notes_page::run_page(conn, &ctes, &page_body, &order.outer, args)
}

/// 当前条件命中的总条数:**仅供测试使用**。视图模块已删(S6),也不再有每页分录计数
/// 徽标(N 页 N 次 COUNT 的代价不合理,当前页的计数由流头部照旧显示),故生产路径不再有调用方。
/// 错误类型与 [`query`] 一致("条件非法" 用中文原因而不是 rusqlite 的英文错误)。
#[cfg(test)]
pub fn count_matching(conn: &Connection, conditions: &FilterConditions) -> Result<i64, String> {
    let (frag, args) = where_clause(conditions)?;
    conn.query_row(
        &format!("SELECT COUNT(*) FROM entities n WHERE n.kind='note' AND ({frag})"),
        rusqlite::params_from_iter(args),
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

#[cfg(test)]
#[path = "notes_query_carry_tests.rs"]
mod notes_query_carry_tests;

#[cfg(test)]
#[path = "notes_query_relation_tests.rs"]
mod notes_query_relation_tests;

#[cfg(test)]
#[path = "notes_query_relation_equiv_tests.rs"]
mod notes_query_relation_equiv_tests;

/// 排序数据模型 / 标签轴排序 / 级联改写的用例(自本文件测试拆分,守 200 行)
#[cfg(test)]
#[path = "notes_query_sort_tests.rs"]
mod notes_query_sort_tests;
