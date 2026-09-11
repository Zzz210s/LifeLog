use rusqlite::Connection;
use std::collections::HashMap;

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

/// 整库笔记导出为 xlsx 字节:单 sheet"笔记",按创建时间倒序。
/// 列:时间(最后修改 updated_at)/正文(纯文本)/标签(#a #b)/创建时间(created_at);
/// 表头加粗,正文列放宽便于阅读。
pub fn export_notes(conn: &Connection) -> Result<Vec<u8>, String> {
    let mut stmt = conn
        .prepare("SELECT id, content, updated_at, created_at FROM notes ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let entries = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    let tags = note_tags(conn)?;

    let mut workbook = rust_xlsxwriter::Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name("笔记").map_err(|e| e.to_string())?;
    let bold = rust_xlsxwriter::Format::new().set_bold();
    let headers = ["时间", "正文", "标签", "创建时间"];
    for (col, h) in headers.iter().enumerate() {
        sheet
            .write_with_format(0, col as u16, *h, &bold)
            .map_err(|e| e.to_string())?;
    }
    for (col, w) in [20, 80, 24, 20].iter().enumerate() {
        sheet.set_column_width(col as u16, *w).map_err(|e| e.to_string())?;
    }
    for (i, (id, content, updated, created)) in entries.iter().enumerate() {
        let row = (i + 1) as u32;
        let cells = [
            updated.as_str(),
            content.as_str(),
            tags.get(id).map(String::as_str).unwrap_or(""),
            created.as_str(),
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
}
