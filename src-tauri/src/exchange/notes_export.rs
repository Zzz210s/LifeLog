use rusqlite::Connection;
use std::collections::HashMap;

/// xlsx 单元格字符上限(rust_xlsxwriter 硬限制):超长整表写出失败
pub const MAX_CELL_CHARS: usize = 32767;
/// 超长正文截断后的中文标注(仅影响导出单元格,DB 原文不动)
const TRUNCATE_MARK: &str = "…(导出已截断)";

/// 导出行(不含表头):时间/正文/标签/创建时间四列
#[derive(Debug, PartialEq)]
pub struct Row {
    pub time: String,
    pub content: String,
    pub tags: String,
    pub created: String,
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

/// 笔记标签按条目聚合:id -> "#a #b"(名升序,空格分隔),与 v1 导出同构
fn note_tags(conn: &Connection) -> Result<HashMap<i64, String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT l.target_id, t.name FROM tag_links l
             JOIN tags t ON t.id = l.tag_id
             WHERE l.target_type = 'note' ORDER BY l.target_id, t.name",
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

/// 表头:时间(最后修改 updated_at)/正文/标签(#a #b)/创建时间(created_at)
pub const HEADERS: [&str; 4] = ["时间", "正文", "标签", "创建时间"];

/// 导出行数据(核心行为单点):创建时间倒序稳定排序、标签聚合、正文截断
pub fn rows(conn: &Connection) -> Result<Vec<Row>, String> {
    let tags = note_tags(conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, content, updated_at, created_at FROM notes \
             ORDER BY created_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in mapped {
        let (id, content, time, created) = row.map_err(|e| e.to_string())?;
        out.push(Row {
            time,
            content: fit_cell(&content),
            tags: tags.get(&id).cloned().unwrap_or_default(),
            created,
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
    for (col, w) in [20, 80, 24, 20].iter().enumerate() {
        sheet.set_column_width(col as u16, *w).map_err(|e| e.to_string())?;
    }
    for (i, r) in rows.iter().enumerate() {
        let row = (i + 1) as u32;
        let cells = [
            r.time.as_str(),
            r.content.as_str(),
            r.tags.as_str(),
            r.created.as_str(),
        ];
        for (col, v) in cells.iter().enumerate() {
            sheet.write(row, col as u16, *v).map_err(|e| e.to_string())?;
        }
    }
    workbook.save_to_buffer().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::db::repos::notes;
    use rusqlite::Connection;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrate::run(&c).unwrap();
        c
    }

    #[test]
    fn export_notes_produces_xlsx_bytes() {
        let mut c = db();
        notes::create(&mut c, "较早一条 #工作").unwrap();
        notes::create(&mut c, "较新一条 #生活 #工作").unwrap();
        let bytes = export_notes(&c).unwrap();
        // xlsx 即 zip 容器:开头魔数 PK\x03\x04
        assert_eq!(&bytes[0..4], &[0x50, 0x4B, 0x03, 0x04]);
        assert!(bytes.len() > 1000);
    }

    #[test]
    fn rows_are_ordered_tagged_and_verbatim() {
        let mut c = db();
        notes::create(&mut c, "较早一条 #工作").unwrap();
        notes::create(&mut c, "    缩进首行\n第二行\n\n#生活 #工作").unwrap();
        notes::create(&mut c, "无标签").unwrap();

        let rows = rows(&c).unwrap();
        let contents: Vec<&str> = rows.iter().map(|r| r.content.as_str()).collect();
        // created_at DESC(同秒按 id DESC):最新在前
        assert_eq!(contents, vec!["无标签", "    缩进首行\n第二行\n\n", "较早一条"]);
        // 标签聚合:多标签名升序、无标签为空串
        assert_eq!(rows[0].tags, "");
        assert_eq!(rows[1].tags, "#工作 #生活");
        assert_eq!(rows[2].tags, "#工作");
        // 创建时间列稳定降序
        assert!(rows[0].created >= rows[1].created);
        assert!(rows[1].created >= rows[2].created);
    }

    #[test]
    fn long_content_is_truncated_with_mark() {
        let mut c = db();
        notes::create(&mut c, &"a".repeat(MAX_CELL_CHARS + 100)).unwrap();

        let rows = rows(&c).unwrap();
        let cell = &rows[0].content;
        assert_eq!(cell.chars().count(), MAX_CELL_CHARS);
        assert!(cell.ends_with("…(导出已截断)"));
        assert!(cell.starts_with("aaaa"));
    }

    #[test]
    fn fit_cell_keeps_short_content_untouched() {
        assert_eq!(fit_cell("短正文\n    缩进"), "短正文\n    缩进");
    }

    #[test]
    fn export_notes_survives_overlong_content() {
        let mut c = db();
        notes::create(&mut c, &"b".repeat(MAX_CELL_CHARS + 50)).unwrap();
        let bytes = export_notes(&c).unwrap();
        assert_eq!(&bytes[0..4], &[0x50, 0x4B, 0x03, 0x04]);
    }
}
