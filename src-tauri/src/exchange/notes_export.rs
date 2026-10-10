use crate::db::repos::notes::notes_filter::{where_clause, FilterConditions};
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY};
use rusqlite::Connection;

use super::notes_export_refs::refs_by_source;

/// xlsx 单元格字符上限(rust_xlsxwriter 硬限制):超长整表写出失败
pub const MAX_CELL_CHARS: usize = 32767;
/// 超长正文截断后的中文标注(仅影响导出单元格,DB 原文不动)
const TRUNCATE_MARK: &str = "…(导出已截断)";

/// 导出行(不含表头),spec §6.6 列结构:`id, meta, created_at, 引用路径列表`。
#[derive(Debug, PartialEq)]
pub struct Row {
    pub id: i64,
    /// 正文/名称(统一实体的 `meta`)
    pub meta: String,
    pub created_at: String,
    /// 出链目标显示名列表(`edges.kind='link'`),空格分隔
    pub refs: String,
}

/// 单元格正文:未超长原样返回;超长按字符数截断并在末尾标注(总长不超上限)
pub fn fit_cell(content: &str) -> String {
    if content.chars().count() <= MAX_CELL_CHARS {
        return content.to_string();
    }
    let keep = MAX_CELL_CHARS - TRUNCATE_MARK.chars().count();
    let mut out: String = content.chars().take(keep).collect();
    out.push_str(TRUNCATE_MARK);
    out
}

/// 表头:id / 正文(meta) / 创建时间 / 引用路径列表(spec §6.6)
pub const HEADERS: [&str; 4] = ["id", "正文", "创建时间", "引用路径"];

/// 当前筛选条件:settings.filter_current(与信息流同一份);缺失/坏 JSON 退化为空条件(= 全部实体)。
fn current_filter(conn: &Connection) -> FilterConditions {
    settings::get(conn, FILTER_CURRENT_KEY)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// 导出 = 信息流**当前筛选结果**(全部实体中的命中),按实体 id 降序(最新在前);
/// 引用列聚合该实体的出 `link` 闭包显示名(见 [`super::notes_export_refs`])。
pub fn rows(conn: &Connection) -> Result<Vec<Row>, String> {
    let (frag, args) = where_clause(&current_filter(conn))?;
    let refs = refs_by_source(conn)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT n.id, n.meta, n.created_at FROM entities n WHERE ({frag}) ORDER BY n.id DESC"
        ))
        .map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(rusqlite::params_from_iter(args), |r| {
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

/// 当前筛选结果导出为 xlsx 字节:单 sheet"条目",表头加粗,正文列放宽便于阅读。
pub fn export_notes(conn: &Connection) -> Result<Vec<u8>, String> {
    let rows = rows(conn)?;
    let mut workbook = rust_xlsxwriter::Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name("条目").map_err(|e| e.to_string())?;
    let bold = rust_xlsxwriter::Format::new().set_bold();
    for (col, h) in HEADERS.iter().enumerate() {
        sheet
            .write_with_format(0, col as u16, *h, &bold)
            .map_err(|e| e.to_string())?;
    }
    for (col, w) in [12, 80, 22, 40].iter().enumerate() {
        sheet.set_column_width(col as u16, *w).map_err(|e| e.to_string())?;
    }
    for (i, r) in rows.iter().enumerate() {
        let row = (i + 1) as u32;
        sheet.write(row, 0, r.id).map_err(|e| e.to_string())?;
        let cells = [r.meta.as_str(), r.created_at.as_str(), r.refs.as_str()];
        for (col, v) in cells.iter().enumerate() {
            sheet.write(row, (col + 1) as u16, *v).map_err(|e| e.to_string())?;
        }
    }
    workbook.save_to_buffer().map_err(|e| e.to_string())
}

/// 导出行为测试(拆出模块,守 200 行上限)
#[cfg(test)]
#[path = "notes_export_tests.rs"]
mod notes_export_tests;
