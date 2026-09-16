//! 表达式失效路径检测(自 views.rs 拆出,守 200 行上限):
//! 一次 `SELECT path FROM tags` 建全量路径集合,再与视图表达式引用的路径求差集
//! (避免逐视图查库的 N 次查询)。只在读取 DTO 时标记,不改任何表达式文本。
use crate::db::repos::saved_views_rewrite;
use rusqlite::Connection;
use std::collections::HashSet;

/// 库中全部标签路径(含系统的时间子树)—— 一次查询建集合
pub(super) fn known_paths(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn.prepare("SELECT path FROM tags").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<HashSet<String>>>().map_err(|e| e.to_string())
}

/// 表达式引用但库中不存在的标签路径(去重、保持出现顺序);无表达式则空数组。
/// 口径:逐字路径存在性 —— 标签树里父路径必定存在,故更深的路径不在集合里即为失效。
pub(super) fn of(expr: Option<&str>, known: &HashSet<String>) -> Vec<String> {
    let Some(src) = expr else {
        return Vec::new();
    };
    saved_views_rewrite::expr_paths(src).into_iter().filter(|p| !known.contains(p)).collect()
}
