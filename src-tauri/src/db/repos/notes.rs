use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Serialize, Debug)]
pub struct Note {
    pub id: i64,
    pub content: String,
    pub created_at: String,
    pub tags: Vec<String>,
}

/// 存库前移除 #标签 词元:单遍扫描原文(词法同 extract_tags,共用 scan_tag_token),
/// 保留非标签段、丢弃标签 token、裸 # 保留,最后逐行折叠空白并保留行结构
/// (多行笔记的换行与空行原样保留;标签折叠进 tags/tag_links,原文保留会双重展示)
fn strip_tags(content: &str) -> String {
    let content = content.replace("\r\n", "\n"); // 统一换行,防 Windows 端混入 \r
    let mut out = String::new();
    let mut chars = content.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '#' {
            out.push(c);
            continue;
        }
        if crate::tags::scan_tag_token(&mut chars).is_none() {
            out.push(c); // 裸 # 不属于标签,保留为内容
        }
    }
    out.split('\n')
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn create(conn: &mut Connection, content: &str) -> rusqlite::Result<Note> {
    let names = crate::tags::extract_tags(content);
    let text = strip_tags(content);
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
         WHERE n.id IN (SELECT id FROM notes ORDER BY id DESC LIMIT ?1)
         ORDER BY n.id DESC, t.name",
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

/// 删除笔记(事务):先删 tag_links 再删 note,最后清理无任何链接的孤儿 tags
pub fn delete(conn: &mut Connection, id: i64) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM tag_links WHERE target_type='note' AND target_id=?1", params![id])?;
    tx.execute("DELETE FROM notes WHERE id=?1", params![id])?;
    tx.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM tag_links)",
        [],
    )?;
    tx.commit()
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

    /// 断言用:返回标量 COUNT 查询结果
    fn count(c: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql]) -> i64 {
        c.query_row(sql, params, |r| r.get(0)).unwrap()
    }

    #[test]
    fn create_parses_tags_and_links() {
        let mut c = db();
        let n = create(&mut c, "看完了 #流浪地球 #科幻").unwrap();
        assert_eq!(n.tags, vec!["流浪地球", "科幻"]);
        let links = count(&c, "SELECT COUNT(*) FROM tag_links", &[]);
        assert_eq!(links, 2);
    }

    #[test]
    fn tags_reused_across_notes() {
        let mut c = db();
        create(&mut c, "a #x").unwrap();
        create(&mut c, "b #x").unwrap();
        let tags = count(&c, "SELECT COUNT(*) FROM tags WHERE name='x'", &[]);
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

    #[test]
    fn create_strips_tags_without_prefix_collision() {
        let mut c = db();
        let n = create(&mut c, "看完了 #书 想买 #书评").unwrap();
        assert_eq!(n.content, "看完了 想买");
        assert_eq!(n.tags, vec!["书", "书评"]);
    }

    #[test]
    fn create_preserves_multiline_structure() {
        let mut c = db();
        let n = create(&mut c, "第一行 #tag\n第二行\n\n第三段").unwrap();
        assert_eq!(n.content, "第一行\n第二行\n\n第三段");
        assert_eq!(n.tags, vec!["tag"]);
        // CRLF 输入归一为 LF,行结构同样保留
        let n2 = create(&mut c, "第一行 #tag\r\n第二行\r\n\r\n第三段").unwrap();
        assert_eq!(n2.content, "第一行\n第二行\n\n第三段");
        assert_eq!(n2.tags, vec!["tag"]);
    }

    #[test]
    fn recent_limit_counts_notes_not_rows() {
        let mut c = db();
        create(&mut c, "one #t1").unwrap();
        create(&mut c, "two #t2 #t3").unwrap();
        create(&mut c, "three #t4").unwrap();
        let list = recent(&c, 2).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].content, "three");
        assert_eq!(list[1].content, "two");
        assert_eq!(list[1].tags, vec!["t2", "t3"]);
    }

    #[test]
    fn delete_removes_note_links_and_orphan_tags() {
        let mut c = db();
        let n = create(&mut c, "a #孤儿").unwrap();
        create(&mut c, "b #共用").unwrap();
        delete(&mut c, n.id).unwrap();
        let notes = count(&c, "SELECT COUNT(*) FROM notes", &[]);
        assert_eq!(notes, 1);
        let links = count(
            &c,
            "SELECT COUNT(*) FROM tag_links WHERE target_type='note' AND target_id=?1",
            &[&n.id],
        );
        assert_eq!(links, 0);
        let orphan = count(&c, "SELECT COUNT(*) FROM tags WHERE name='孤儿'", &[]);
        assert_eq!(orphan, 0);
        let kept = count(&c, "SELECT COUNT(*) FROM tags WHERE name='共用'", &[]);
        assert_eq!(kept, 1);
    }
}
