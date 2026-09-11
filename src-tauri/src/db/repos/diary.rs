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
    // 标签管线同 notes:提取 -> 正文剥离;但为替换语义:
    // 每次保存先清空旧链再插入当前标签(重存不残留旧标签)
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
    // 替换语义:插入与更新路径统一,先删旧链再写当前标签
    tx.execute("DELETE FROM tag_links WHERE target_type='diary' AND target_id=?1", params![id])?;
    for name in &names {
        tx.execute("INSERT OR IGNORE INTO tags(name) VALUES(?1)", params![name])?;
        let tid: i64 =
            tx.query_row("SELECT id FROM tags WHERE name = ?1", params![name], |r| r.get(0))?;
        tx.execute(
            "INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'diary', ?2)",
            params![tid, id],
        )?;
    }
    // 孤儿标签回收(同 notes::delete):链已替换,无引用的 tag 行清掉
    tx.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM tag_links)",
        [],
    )?;
    // 返回前从 tag_links 读全量标签(与 get_by_date 语义一致)
    let entry = read_entry(&tx, date)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    tx.commit()?;
    Ok(entry)
}

/// 按日期取单条(含 tag_links 关联标签);无该日返回 None
pub fn get_by_date(conn: &Connection, date: &str) -> Option<DiaryEntry> {
    read_entry(conn, date).ok().flatten()
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

/// 读单行 + tag_links 全量标签(按名升序);无该日返回 None。
/// upsert(commit 前)与 get_by_date 共用,保证两路返回语义一致。
fn read_entry(conn: &Connection, date: &str) -> rusqlite::Result<Option<DiaryEntry>> {
    let row = conn.query_row(
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
    );
    let mut entry = match row {
        Ok(e) => e,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e),
    };
    let mut stmt = conn.prepare(
        "SELECT t.name FROM tag_links l JOIN tags t ON t.id = l.tag_id
         WHERE l.target_type = 'diary' AND l.target_id = ?1 ORDER BY t.name",
    )?;
    let rows = stmt.query_map(params![entry.id], |r| r.get::<_, String>(0))?;
    entry.tags = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Some(entry))
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
        // 无标签重存:替换语义,旧链清空 + 孤儿标签回收,返回全量标签(空)
        let b = upsert(&mut c, "2026-09-11", "标题2", "改了", None, Some("晴")).unwrap();
        assert_eq!(b.id, a.id);
        assert_eq!(b.title, "标题2");
        assert_eq!(b.tags, Vec::<String>::new());
        let count: i64 = c.query_row("SELECT COUNT(*) FROM diary_entries", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        let links: i64 = c.query_row(
            "SELECT COUNT(*) FROM tag_links WHERE target_type='diary'", [], |r| r.get(0)).unwrap();
        assert_eq!(links, 0);
        let orphan: i64 = c.query_row(
            "SELECT COUNT(*) FROM tags WHERE name='开心'", [], |r| r.get(0)).unwrap();
        assert_eq!(orphan, 0);
        // 换新标签再存:库里只有新链,返回 tag_links 全量
        let d = upsert(&mut c, "2026-09-11", "标题3", "心情 #平静", None, None).unwrap();
        assert_eq!(d.tags, vec!["平静"]);
        assert_eq!(get_by_date(&c, "2026-09-11").unwrap().tags, vec!["平静"]);
        let links2: i64 = c.query_row(
            "SELECT COUNT(*) FROM tag_links WHERE target_type='diary'", [], |r| r.get(0)).unwrap();
        assert_eq!(links2, 1);
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
