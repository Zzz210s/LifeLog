//! 自建视图批量命中计数(自 views.rs 拆出以守 200 行上限):
//! 内置三视图(键 all/todo/untagged)在前,自建视图按 sort_order(键 view:<id>)在后,
//! 数值口径与 notes_query::count_matching 完全一致(供侧栏徽标)。
use super::{builtins, conditions_of_builtin, list};
use crate::db::repos::notes::notes_query::count_matching;
use rusqlite::Connection;

/// 批量命中计数:内置三视图 + 自建视图
pub fn hit_counts(conn: &Connection) -> Result<Vec<(String, i64)>, String> {
    let mut out: Vec<(String, i64)> = Vec::new();
    for (key, _) in builtins() {
        let n = count_matching(conn, &conditions_of_builtin(key)).map_err(|e| e.to_string())?;
        out.push((key.to_string(), n));
    }
    for v in list(conn)? {
        let n = count_matching(conn, &v.conditions).map_err(|e| e.to_string())?;
        out.push((format!("view:{}", v.id), n));
    }
    Ok(out)
}
