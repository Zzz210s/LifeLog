//! 「全选筛选结果」的取数仓库层(spec 2026-10-17 §3.4):返回当前条件下**全部命中 id**,
//! 与信息流查共用同一套谓词(`where_clause`)与同一份沉尾行序,不分页。
use crate::db::repos::notes::notes_filter::{feed_sink_predicate, where_clause, FilterConditions};
use rusqlite::{params_from_iter, Connection};

/// 当前条件命中的全部点 id(沉尾键 ASC, id DESC —— 与 `query_notes` 同序)。
pub fn filter_ids(conn: &Connection, conditions: &FilterConditions) -> Result<Vec<i64>, String> {
    let (frag, args) = where_clause(conditions)?;
    let sink = feed_sink_predicate("n");
    let mut stmt = conn
        .prepare(&format!(
            "SELECT n.id FROM points n WHERE ({frag}) ORDER BY ({sink}) ASC, n.id DESC"
        ))
        .map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(params_from_iter(args), |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in mapped {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[cfg(test)]
#[path = "batch_ids_tests.rs"]
mod batch_ids_tests;
