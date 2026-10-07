//! notes 流查询层(自 notes.rs 拆出以守 200 行上限):条件化 query + count_matching
//! (旧标签板的 count_tags 已随标签板移除而清理)
use super::notes_filter::{where_clause, FilterConditions};
use super::notes_sort::{effective_sorts, SortCond};
use super::tag_order;
use super::{fold_tag_rows, map_note_row, Note};
use rusqlite::{params_from_iter, types::Value, Connection};

/// 每页条数(与前端分页常量 `PAGE` 一致);分页只由 offset 驱动
pub const PAGE_SIZE: i64 = 50;

/// 排序 SQL 的拼装结果(inner = page CTE 内,outer = 折叠联表后)
struct OrderSql {
    /// 需要的 CTE 定义(`ord` + 各 `axis{i}`);空 = 纯时间排序(不需要 ord)
    ctes: Vec<String>,
    /// page CTE 里 `FROM notes n` 之后的 LEFT JOIN 串(含前导空格)
    joins: String,
    /// page CTE 额外选择的键列(`ax0.key AS k0`);外层按它排同一顺序
    page_cols: String,
    inner: String,
    outer: String,
}

/// 由生效排序生成多键排序片段(设计 §4.3):
/// - 标签轴先经 `axis{i}` CTE 取该轴(子树,恒含子级)下**树序最靠前**的匹配标签,page 携带 `k{i}`;
/// - `enabled=false` 跳过;无启用条件时退化为默认最新在前;
/// - **无该标签的笔记恒排最后**(`key IS NULL` 升序,与方向无关);
/// - 末位按首键方向以 `n.id` 兜底(分页稳定、不抖动)。
fn build_order(sorts: &[SortCond], args: &mut Vec<Value>) -> OrderSql {
    let active: Vec<&SortCond> = sorts.iter().filter(|s| s.enabled()).collect();
    let mut ctes: Vec<String> = Vec::new();
    let mut joins = String::new();
    let mut cols: Vec<String> = Vec::new();
    let mut inner: Vec<String> = Vec::new();
    let mut outer: Vec<String> = Vec::new();
    for s in &active {
        let dir = if s.is_desc() { "DESC" } else { "ASC" };
        match s {
            SortCond::Tag { path, .. } => {
                let axis = tag_order::axis_sql(ctes.len(), path, args);
                let k = cols.len();
                joins.push(' ');
                joins.push_str(&axis.join);
                cols.push(format!("{} AS k{k}", axis.key));
                inner.push(format!("{} IS NULL, {} {dir}", axis.key, axis.key));
                outer.push(format!("p.k{k} IS NULL, p.k{k} {dir}"));
                ctes.push(axis.cte);
            }
            SortCond::Time { .. } => {
                inner.push(format!("n.id {dir}"));
                outer.push(format!("n.id {dir}"));
            }
        }
    }
    let fallback = active
        .first()
        .map_or("DESC", |s| if s.is_desc() { "DESC" } else { "ASC" });
    inner.push(format!("n.id {fallback}"));
    outer.push(format!("n.id {fallback}"));
    OrderSql {
        ctes,
        joins,
        page_cols: if cols.is_empty() {
            String::new()
        } else {
            format!(", {}", cols.join(", "))
        },
        inner: inner.join(", "),
        outer: outer.join(", "),
    }
}

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
    let order = build_order(&effective_sorts(conditions), &mut args);
    let (frag, where_args) = where_clause(conditions)?;
    args.extend(where_args);
    args.push(Value::Integer(offset.max(0)));
    let recursive = if order.ctes.is_empty() { "" } else { "RECURSIVE " };
    let mut ctes: Vec<String> = Vec::new();
    // 树序键 ord 是所有 axis CTE 的前置;无标签轴排序时不需要(见 tag_order::ORD_BODY)
    if !order.ctes.is_empty() {
        ctes.push(tag_order::ORD_BODY.to_string());
    }
    ctes.extend(order.ctes);
    ctes.push(format!(
        "page AS (
           SELECT n.id AS id{}
           FROM notes n{}
           WHERE {frag}
           ORDER BY {}
           LIMIT {PAGE_SIZE} OFFSET ?
         )",
        order.page_cols, order.joins, order.inner
    ));
    let sql = format!(
        "WITH {recursive}{}
         SELECT n.id, n.content, n.created_at, t.path
         FROM page p
         JOIN notes n ON n.id = p.id
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         ORDER BY {}, t.path",
        ctes.join(",\n         "),
        order.outer
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(args), map_note_row)
        .map_err(|e| e.to_string())?;
    let mut notes = fold_tag_rows(rows).map_err(|e| e.to_string())?;
    // 出链随页返回:一页 50 条用 `IN (...)` 一次取全,不能每张卡一条查询(设计 §3.0)。
    let ids: Vec<i64> = notes.iter().map(|n| n.id).collect();
    let mut links = crate::db::repos::note_links::outbound_page(conn, &ids).map_err(|e| e.to_string())?;
    for n in &mut notes {
        n.links = links.remove(&n.id).unwrap_or_default();
    }
    Ok(notes)
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
