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
pub(crate) fn strip_tags(content: &str) -> String {
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

/// 行映射:note 基础列 + 可空标签名(LEFT JOIN 按标签展开成多行)
type NoteRow = (i64, String, String, Option<String>);

fn map_note_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<NoteRow> {
    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
}

/// 相邻同 id 行折叠为一个 Note(tags 收集为列表),recent 与 query 共用
fn fold_tag_rows(rows: impl Iterator<Item = rusqlite::Result<NoteRow>>) -> rusqlite::Result<Vec<Note>> {
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

pub fn recent(conn: &Connection, limit: u32) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.content, n.created_at, t.name
         FROM notes n
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         WHERE n.id IN (SELECT id FROM notes ORDER BY id DESC LIMIT ?1)
         ORDER BY n.id DESC, t.name",
    )?;
    let rows = stmt.query_map(params![limit], map_note_row)?;
    fold_tag_rows(rows)
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

/// 流查询条件:关键词 + 标签 AND + 分页排序
#[derive(Debug)]
pub struct NoteFilter {
    pub keyword: Option<String>,
    pub tags: Vec<String>,
    pub offset: i64,
    pub limit: i64,
    pub oldest_first: bool,
}

/// 按条件查询笔记流:
/// - keyword >=3 字符走 FTS MATCH(短语加引号防语法注入,尾缀 * 前缀匹配),content/tags 列皆可命中
/// - <3 字符退化 LIKE(SQLite 默认 ASCII 大小写不敏感),正文或任一标签名命中即返回
/// - tags 为 AND 语义:每标签一个 EXISTS 子句,全部满足才命中
/// - 分页排序在 id 子查询内完成,外层仅做标签行折叠
pub fn query(conn: &Connection, f: &NoteFilter) -> rusqlite::Result<Vec<Note>> {
    let mut clauses: Vec<String> = Vec::new();
    let mut args: Vec<String> = Vec::new();
    let kw = f.keyword.as_deref().map(str::trim).filter(|k| !k.is_empty());
    if let Some(k) = kw {
        if k.chars().count() >= 3 {
            clauses.push(format!(
                "id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?{})",
                args.len() + 1
            ));
            args.push(format!("\"{}\"*", k.replace('"', "\"\"")));
        } else {
            clauses.push(format!(
                "(content LIKE ?{n} OR EXISTS(SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id
                  WHERE l.target_type = 'note' AND l.target_id = notes.id AND t.name LIKE ?{n}))",
                n = args.len() + 1
            ));
            args.push(format!("%{}%", k));
        }
    }
    for name in &f.tags {
        clauses.push(format!(
            "EXISTS(SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id
             WHERE l.target_type = 'note' AND l.target_id = notes.id AND t.name = ?{})",
            args.len() + 1
        ));
        args.push(name.clone());
    }
    let cond = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    let dir = if f.oldest_first { "ASC" } else { "DESC" };
    let limit = if f.limit <= 0 { 50 } else { f.limit };
    let (li, oi) = (args.len() + 1, args.len() + 2);
    args.push(limit.to_string());
    args.push(f.offset.max(0).to_string());
    let sql = format!(
        "SELECT n.id, n.content, n.created_at, t.name
         FROM notes n
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         WHERE n.id IN (SELECT id FROM notes {cond} ORDER BY id {dir} LIMIT ?{li} OFFSET ?{oi})
         ORDER BY n.id {dir}, t.name"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args), map_note_row)?;
    fold_tag_rows(rows)
}

/// 标签使用计数(仅统计 note 链接):按次数降序,同数按名升序
pub fn count_tags(conn: &Connection) -> Vec<(String, i64)> {
    conn.prepare(
        "SELECT t.name, COUNT(*) FROM tag_links l JOIN tags t ON t.id = l.tag_id
         WHERE l.target_type = 'note' GROUP BY t.name ORDER BY COUNT(*) DESC, t.name",
    )
    .and_then(|mut stmt| {
        let rows =
            stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
    .unwrap_or_default()
}

#[cfg(test)]
#[path = "notes_query_tests.rs"]
mod notes_query_tests;

#[cfg(test)]
#[path = "notes_tests.rs"]
mod notes_tests;
