use rusqlite::Connection;
use std::collections::HashMap;

/// 日记标签按条目聚合:target_id -> "#a #b"(名升序,空格分隔)
fn diary_tags(conn: &Connection) -> Result<HashMap<i64, String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT l.target_id, t.name FROM tag_links l
             JOIN tags t ON t.id = l.tag_id
             WHERE l.target_type = 'diary' ORDER BY l.target_id, t.name",
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

/// 全量日记导出为 xlsx 字节:单 sheet"日记",按日期升序,
/// 列:日期/标题/正文/心情/天气/标签(#a #b 空格分隔)/更新时间,表头加粗
pub fn export_diary(conn: &Connection) -> Result<Vec<u8>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, date, title, content, mood, weather, updated_at
             FROM diary_entries ORDER BY date ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let entries = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    let tags = diary_tags(conn)?;

    let mut workbook = rust_xlsxwriter::Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name("日记").map_err(|e| e.to_string())?;
    let bold = rust_xlsxwriter::Format::new().set_bold();
    let headers = ["日期", "标题", "正文", "心情", "天气", "标签", "更新时间"];
    for (col, h) in headers.iter().enumerate() {
        sheet
            .write_with_format(0, col as u16, *h, &bold)
            .map_err(|e| e.to_string())?;
    }
    for (col, w) in [12, 24, 60, 8, 8, 24, 20].iter().enumerate() {
        sheet.set_column_width(col as u16, *w).map_err(|e| e.to_string())?;
    }
    for (i, (id, date, title, content, mood, weather, updated)) in entries.iter().enumerate() {
        let row = (i + 1) as u32;
        let cells = [
            date.as_str(),
            title.as_str(),
            content.as_str(),
            mood.as_deref().unwrap_or(""),
            weather.as_deref().unwrap_or(""),
            tags.get(id).map(String::as_str).unwrap_or(""),
            updated.as_str(),
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
    use crate::db::repos::diary::upsert;
    use rusqlite::Connection;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrate::run(&c).unwrap();
        c
    }

    #[ignore = "diary 模块 Task 2 移除"]
    #[test]
    fn export_diary_produces_xlsx_bytes() {
        let mut c = db();
        upsert(&mut c, "2026-09-02", "次日", "内容一条 #天气好", Some("好"), Some("晴")).unwrap();
        upsert(&mut c, "2026-09-01", "首日", "更早一条 #开心", None, None).unwrap();
        let bytes = export_diary(&c).unwrap();
        // xlsx 即 zip 容器:开头魔数 PK\x03\x04
        assert_eq!(&bytes[0..4], &[0x50, 0x4B, 0x03, 0x04]);
        assert!(bytes.len() > 1000);
    }
}
