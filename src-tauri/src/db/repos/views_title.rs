//! 视图标题校验(非空、长度上限、不与其他视图重名),从 views.rs 拆出以守 200 行上限,
//! 调用路径仍是 `views::check_title`(re-export)。
use rusqlite::{params, Connection};

/// 标题上限(字符数,含两侧去空白后)
pub const MAX_TITLE_CHARS: usize = 40;

/// 标题校验:非空(去空白)、不超上限、不与其他视图重名(exclude_id 供改名时排除自己)。
/// 通过则返回去空白后的标题。
pub fn check_title(conn: &Connection, title: &str, exclude_id: Option<i64>) -> Result<String, String> {
    let t = title.trim();
    if t.is_empty() {
        return Err("视图名称不能为空".into());
    }
    if t.chars().count() > MAX_TITLE_CHARS {
        return Err(format!("视图名称最多 {MAX_TITLE_CHARS} 字"));
    }
    // exclude_id 为 NULL 时不过滤 id,任何同名行都算重名
    let dup: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM saved_views WHERE title = ?1 AND (?2 IS NULL OR id <> ?2)",
            params![t, exclude_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if dup > 0 {
        return Err("已有同名视图".into());
    }
    Ok(t.to_string())
}
