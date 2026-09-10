use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Serialize, Debug)]
pub struct Note {
    pub id: i64,
    pub content: String,
    pub created_at: String,
    pub tags: Vec<String>,
}

/// 存库前移除 #标签 词元,折叠空白(标签折叠进 tags/tag_links,原文保留会双重展示)
fn strip_tags(content: &str, tags: &[String]) -> String {
    let mut out = content.to_string();
    for t in tags {
        out = out.replace(&format!("#{t}"), "");
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn create(conn: &mut Connection, content: &str) -> rusqlite::Result<Note> {
    let names = crate::tags::extract_tags(content);
    let text = strip_tags(content, &names);
    let tx = conn.transaction()?;
    tx.execute("INSERT INTO notes(content) VALUES(?1)", params![text])?;
    let id = tx.last_insert_rowid();
    for name in &names {
        tx.execute("INSERT OR IGNORE INTO tags(name) VALUES(?1)", params![name])?;
        let tid: i64 = tx
            .query_row("SELECT id FROM tags WHERE name = ?1", params![name], |r| r.get(0))?;
        tx.execute(
            "INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'note', ?2)",
            params![tid, id],
        )?;
    }
    let created_at: String = tx
        .query_row("SELECT created_at FROM notes WHERE id = ?1", params![id], |r| r.get(0))?;
    tx.commit()?;
    Ok(Note { id, content: text, created_at, tags: names })
}

pub fn recent(conn: &Connection, limit: u32) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.content, n.created_at, t.name
         FROM notes n
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         ORDER BY n.id DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
        ))
    })?;
    let mut out: Vec<Note> = Vec::new();
    for row in rows {
        let (id, content, created_at, tag) = row?;
        match out.last_mut() {
            Some(n) if n.id == id => {
                if let Some(t) = tag {
                    n.tags.push(t);
                }
            }
            _ => out.push(Note { id, content, created_at, tags: tag.into_iter().collect() }),
        }
    }
    Ok(out)
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
    fn create_parses_tags_and_links() {
        let mut c = db();
        let n = create(&mut c, "看完了 #流浪地球 #科幻").unwrap();
        assert_eq!(n.tags, vec!["流浪地球", "科幻"]);
        let links: i64 = c
            .query_row("SELECT COUNT(*) FROM tag_links", [], |r| r.get(0))
            .unwrap();
        assert_eq!(links, 2);
    }

    #[test]
    fn tags_reused_across_notes() {
        let mut c = db();
        create(&mut c, "a #x").unwrap();
        create(&mut c, "b #x").unwrap();
        let tags: i64 = c
            .query_row("SELECT COUNT(*) FROM tags WHERE name='x'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tags, 1);
    }

    #[test]
    fn recent_orders_desc_with_tags() {
        let mut c = db();
        create(&mut c, "one #t1").unwrap();
        create(&mut c, "two #t2").unwrap();
        let list = recent(&c, 20).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].content, "two");
        assert_eq!(list[0].tags, vec!["t2"]);
        assert_eq!(list[1].tags, vec!["t1"]);
    }
}
