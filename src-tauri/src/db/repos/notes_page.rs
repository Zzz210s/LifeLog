//! 分页 SQL 的公共件(自 `notes_query.rs` 拆出,守 200 行上限):
//! 排序片段拼装、CTE 前缀、外层取数与标签行折叠 —— 平铺查询与分组查询共用同一份,
//! 杜绝「分组模式另写一套筛选/排序」的语义漂移。
use super::notes_sort::SortCond;
use super::tag_order;
use super::{fold_tag_rows, map_note_row, Note};
use rusqlite::{params_from_iter, types::Value, Connection};

/// 每页条数(与前端分页常量 `PAGE` 一致);分页只由 offset 驱动
pub const PAGE_SIZE: i64 = 50;

/// 排序 SQL 的拼装结果(inner = page CTE 内,outer = 折叠联表后)
pub struct OrderSql {
    /// 需要的 CTE 定义(`ord` + 各 `axis{i}`);空 = 纯时间排序(不需要 ord)
    pub ctes: Vec<String>,
    /// page CTE 里 `FROM notes n` 之后的 LEFT JOIN 串(含前导空格)
    pub joins: String,
    /// page CTE 额外选择的键列(`ax0.key AS k0`);外层按它排同一顺序
    pub page_cols: String,
    pub inner: String,
    pub outer: String,
}

/// 由生效排序生成多键排序片段(设计 §4.3):
/// - 标签轴先经 `axis{i}` CTE 取该轴(子树,恒含子级)下**树序最靠前**的匹配标签,page 携带 `k{i}`;
/// - `enabled=false` 跳过;无启用条件时退化为默认最新在前;
/// - **无该标签的笔记恒排最后**(`key IS NULL` 升序,与方向无关);
/// - 末位按首键方向以 `n.id` 兜底(分页稳定、不抖动)。
pub fn build_order(sorts: &[SortCond], args: &mut Vec<Value>) -> OrderSql {
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

/// `WITH RECURSIVE` + CTE 列表 + 尾部(尾部 = 顶层 SQL,不带 `,`);空列表只返回尾部。
/// 恒带 `RECURSIVE`(SQLite 允许无递归 CTE 时也这么写),省掉「谁递归」的判别。
pub fn with_ctes(ctes: &[String], tail: &str) -> String {
    if ctes.is_empty() {
        tail.to_string()
    } else {
        format!("WITH RECURSIVE {}\n{tail}", ctes.join(",\n"))
    }
}

/// 出链随页返回:一页 50 条用 `IN (...)` 一次取全,不能每张卡一条查询(设计 §3.0)。
pub fn attach_links(conn: &Connection, notes: &mut [Note]) -> Result<(), String> {
    let ids: Vec<i64> = notes.iter().map(|n| n.id).collect();
    let mut links =
        crate::db::repos::note_links::outbound_page(conn, &ids).map_err(|e| e.to_string())?;
    for n in notes.iter_mut() {
        n.links = links.remove(&n.id).unwrap_or_default();
    }
    Ok(())
}

/// 执行一条「`page` CTE + 外层按 `outer_order` 折叠标签行」的查询,返回带出链的笔记流。
/// `page_body` 必须是完整的 `page AS (SELECT n.id AS id ... )` 片段。
pub fn run_page(
    conn: &Connection,
    ctes: &[String],
    page_body: &str,
    outer_order: &str,
    args: Vec<Value>,
) -> Result<Vec<Note>, String> {
    let mut all: Vec<String> = ctes.to_vec();
    all.push(page_body.to_string());
    let tail = format!(
        "SELECT n.id, n.content, n.created_at, t.path
         FROM page p
         JOIN notes n ON n.id = p.id
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         ORDER BY {outer_order}, t.path"
    );
    let sql = with_ctes(&all, &tail);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(args), map_note_row)
        .map_err(|e| e.to_string())?;
    let mut notes = fold_tag_rows(rows).map_err(|e| e.to_string())?;
    attach_links(conn, &mut notes)?;
    Ok(notes)
}
