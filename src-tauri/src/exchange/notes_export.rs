use rusqlite::Connection;
use std::collections::HashMap;

/// xlsx 单元格字符上限(rust_xlsxwriter 硬限制):超长整表写出失败
pub const MAX_CELL_CHARS: usize = 32767;
/// 超长正文截断后的中文标注(仅影响导出单元格,DB 原文不动)
const TRUNCATE_MARK: &str = "…(导出已截断)";

/// 导出行(不含表头):日期/正文/标签/最后修改四列。
/// 日期取自**时间标签**路径(`YYYY-MM-DD`),无时间标签则留空(D2:不再导出 created_at);
/// 最后修改取 updated_at 物理列。
#[derive(Debug, PartialEq)]
pub struct Row {
    pub date: String,
    pub content: String,
    pub tags: String,
    pub updated: String,
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

/// 笔记标签按条目聚合:id -> "#a #b"(完整路径升序,空格分隔)
/// 聚合真源是 t.path 而非 t.name:嵌套标签只留末级名会丢层级,
/// 且不同父级下的同名末级(如 工作/会议 与 生活/会议)无法区分。
fn note_tags(conn: &Connection) -> Result<HashMap<i64, String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT l.target_id, t.path FROM tag_links l
             JOIN tags t ON t.id = l.tag_id
             WHERE l.target_type = 'note' ORDER BY l.target_id, t.path",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut map: HashMap<i64, String> = HashMap::new();
    for row in rows {
        let (id, name) = row.map_err(|e| e.to_string())?;
        let cell = map.entry(id).or_default();
        if !cell.is_empty() {
            cell.push(' ');
        }
        cell.push('#');
        cell.push_str(&name);
    }
    Ok(map)
}

/// 表头:日期(来自时间标签)/正文/标签(#a #b)/最后修改(updated_at)
pub const HEADERS: [&str; 4] = ["日期", "正文", "标签", "最后修改"];

/// 该笔记的时间标签路径(多值兜底取 path 升序首行);`n` 为 notes 别名
fn time_path_sub() -> String {
    format!(
        "(SELECT tt.path FROM tag_links tl JOIN tags tt ON tt.id = tl.tag_id \
         WHERE tl.target_type = 'note' AND tl.target_id = n.id AND {} \
         ORDER BY tt.path LIMIT 1)",
        crate::timetag::sql_is_time_path("tt")
    )
}

/// 导出行数据(核心行为单点):日期列取时间标签、标签聚合、正文/标签截断。
/// 排序与信息流一致:时间标签路径降序(最新在前),同日或无标签用 id 兜底。
pub fn rows(conn: &Connection) -> Result<Vec<Row>, String> {
    let tags = note_tags(conn)?;
    let time_path = time_path_sub();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT n.id, n.content, n.updated_at, {time_path} FROM notes n \
             ORDER BY ({time_path} IS NULL), {time_path} DESC, n.id DESC"
        ))
        .map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in mapped {
        let (id, content, updated, time_path) = row.map_err(|e| e.to_string())?;
        out.push(Row {
            // 无时间标签(回填后不应出现)留空,而不是借用物理列
            date: time_path.as_deref().and_then(crate::timetag::date_from_path).unwrap_or_default(),
            content: fit_cell(&content),
            // 标签同样过 fit_cell:单条笔记标签聚合超上限会让整库导出失败(与正文同一失效模式)
            tags: fit_cell(&tags.get(&id).cloned().unwrap_or_default()),
            updated,
        });
    }
    Ok(out)
}

/// 整库笔记导出为 xlsx 字节:单 sheet"笔记",表头加粗,正文列放宽便于阅读。
pub fn export_notes(conn: &Connection) -> Result<Vec<u8>, String> {
    let rows = rows(conn)?;
    let mut workbook = rust_xlsxwriter::Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name("笔记").map_err(|e| e.to_string())?;
    let bold = rust_xlsxwriter::Format::new().set_bold();
    for (col, h) in HEADERS.iter().enumerate() {
        sheet
            .write_with_format(0, col as u16, *h, &bold)
            .map_err(|e| e.to_string())?;
    }
    for (col, w) in [14, 80, 40, 20].iter().enumerate() {
        sheet.set_column_width(col as u16, *w).map_err(|e| e.to_string())?;
    }
    for (i, r) in rows.iter().enumerate() {
        let row = (i + 1) as u32;
        let cells = [
            r.date.as_str(),
            r.content.as_str(),
            r.tags.as_str(),
            r.updated.as_str(),
        ];
        for (col, v) in cells.iter().enumerate() {
            sheet.write(row, col as u16, *v).map_err(|e| e.to_string())?;
        }
    }
    workbook.save_to_buffer().map_err(|e| e.to_string())
}

/// 导出行为测试(拆出模块,守 200 行上限)
#[cfg(test)]
#[path = "notes_export_tests.rs"]
mod notes_export_tests;
