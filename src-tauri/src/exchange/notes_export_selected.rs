//! 「导出选中」的取数(spec 2026-10-17 §4.4):列结构、列宽、表头都不变,
//! 只把行集从「当前筛选的命中」换成「显式 id 集」;行序仍与信息流一致(沉尾 ASC, id DESC)。
use super::notes_export::{fit_cell, write_workbook, Row};
use super::notes_export_refs::refs_by_source;
use crate::db::repos::notes::notes_filter::feed_sink_predicate;
use rusqlite::Connection;

/// 显式 id 集的导出行(不存在的 id 自然被 `IN` 过滤掉)。
pub fn rows_selected(conn: &Connection, ids: &[i64]) -> Result<Vec<Row>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let refs = refs_by_source(conn)?;
    let sink = feed_sink_predicate("n");
    let holes = vec!["?"; ids.len()].join(",");
    let mut stmt = conn
        .prepare(&format!(
            "SELECT n.id, n.meta, n.created_at FROM points n WHERE n.id IN ({holes}) \
             ORDER BY ({sink}) ASC, n.id DESC"
        ))
        .map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(rusqlite::params_from_iter(ids), |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in mapped {
        let (id, meta, created_at) = row.map_err(|e| e.to_string())?;
        let refs = refs.get(&id).map(|v| v.join(" ")).unwrap_or_default();
        out.push(Row {
            id,
            meta: fit_cell(&meta),
            created_at,
            refs: fit_cell(&refs),
        });
    }
    Ok(out)
}

/// 选中集导出为 xlsx 字节(与整库导出同一套写出)。
pub fn export_selected(conn: &Connection, ids: &[i64]) -> Result<Vec<u8>, String> {
    write_workbook(&rows_selected(conn, ids)?)
}

#[cfg(test)]
#[path = "notes_export_selected_tests.rs"]
mod notes_export_selected_tests;
