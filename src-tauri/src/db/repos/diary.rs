// 临时:命令层(阶段 3 后续任务)接线前暂无调用方,接线后删除此行
#![allow(dead_code)]

use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Serialize, Debug)]
pub struct DiaryEntry {
    pub id: i64,
    pub date: String,
    pub title: String,
    pub content: String,
    pub mood: Option<String>,
    pub weather: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
}

pub fn upsert(
    conn: &mut Connection,
    date: &str,
    title: &str,
    content: &str,
    mood: Option<&str>,
    weather: Option<&str>,
) -> rusqlite::Result<DiaryEntry> {
    // 标签管线同 notes:提取 -> 正文剥离 -> 事务内 tags/tag_links 三连
    let names = crate::tags::extract_tags(content);
    let text = super::notes::strip_tags(content);
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO diary_entries(date, title, content, mood, weather)
         VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(date) DO UPDATE SET
           title = excluded.title,
           content = excluded.content,
           mood = excluded.mood,
           weather = excluded.weather,
           updated_at = datetime('now', 'localtime')",
        params![date, title, text, mood, weather],
    )?;
    let id: i64 =
        tx.query_row("SELECT id FROM diary_entries WHERE date = ?1", params![date], |r| r.get(0))?;
    for name in &names {
        tx.execute("INSERT OR IGNORE INTO tags(name) VALUES(?1)", params![name])?;
        let tid: i64 =
            tx.query_row("SELECT id FROM tags WHERE name = ?1", params![name], |r| r.get(0))?;
        tx.execute(
            "INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'diary', ?2)",
            params![tid, id],
        )?;
    }
    let entry = select_by_date(&tx, date)?;
    tx.commit()?;
    Ok(DiaryEntry { tags: names, ..entry })
}

/// 按日期取单条(含 tag_links 关联标签);无该日返回 None
pub fn get_by_date(conn: &Connection, date: &str) -> Option<DiaryEntry> {
    let mut entry = select_by_date(conn, date).ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT t.name FROM tag_links l JOIN tags t ON t.id = l.tag_id
             WHERE l.target_type = 'diary' AND l.target_id = ?1 ORDER BY t.name",
        )
        .ok()?;
    let rows = stmt.query_map(params![entry.id], |r| r.get::<_, String>(0)).ok()?;
    entry.tags = rows.filter_map(|r| r.ok()).collect();
    Some(entry)
}

/// 月份内已有日记的日期列表(date LIKE 'YYYY-MM-%',升序)
pub fn dates_in_month(conn: &Connection, year: i32, month: i32) -> Vec<String> {
    let pattern = format!("{}-{:02}-%", year, month);
    conn.prepare("SELECT date FROM diary_entries WHERE date LIKE ?1 ORDER BY date")
        .and_then(|mut stmt| {
            let rows = stmt.query_map(params![pattern], |r| r.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })
        .unwrap_or_default()
}

/// 单行读取(不含标签);date 唯一键,至多一行
fn select_by_date(conn: &Connection, date: &str) -> rusqlite::Result<DiaryEntry> {
    conn.query_row(
        "SELECT id, date, title, content, mood, weather, created_at, updated_at
         FROM diary_entries WHERE date = ?1",
        params![date],
        |r| {
            Ok(DiaryEntry {
                id: r.get(0)?,
                date: r.get(1)?,
                title: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                content: r.get(3)?,
                mood: r.get(4)?,
                weather: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
                tags: Vec::new(),
            })
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use rusqlite::Connection;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrate::run(&c).unwrap();
        c
    }

    #[test]
    fn upsert_inserts_then_updates_same_date() {
        let mut c = db();
        let a = upsert(&mut c, "2026-09-11", "标题", "今天 #开心", Some("好"), None).unwrap();
        assert_eq!(a.tags, vec!["开心"]);
        assert_eq!(a.content, "今天");
        let b = upsert(&mut c, "2026-09-11", "标题2", "改了", None, Some("晴")).unwrap();
        assert_eq!(b.id, a.id);
        assert_eq!(b.title, "标题2");
        let count: i64 = c.query_row("SELECT COUNT(*) FROM diary_entries", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        let links: i64 = c.query_row(
            "SELECT COUNT(*) FROM tag_links WHERE target_type='diary'", [], |r| r.get(0)).unwrap();
        assert_eq!(links, 1);
    }
    #[test]
    fn dates_in_month_filters() {
        let mut c = db();
        upsert(&mut c, "2026-09-01", "", "a", None, None).unwrap();
        upsert(&mut c, "2026-09-30", "", "b", None, None).unwrap();
        upsert(&mut c, "2026-08-31", "", "c", None, None).unwrap();
        assert_eq!(dates_in_month(&c, 2026, 9), vec!["2026-09-01", "2026-09-30"]);
        assert!(dates_in_month(&c, 2026, 8).len() == 1);
    }
}
