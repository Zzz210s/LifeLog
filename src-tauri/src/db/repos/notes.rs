use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Serialize, Debug)]
pub struct Note {
    pub id: i64,
    pub content: String,
    pub created_at: String,
    pub tags: Vec<String>,
}

/// 单行空白归一:保留行首空格/制表符(markdown 缩进语义),仅把行内连续空白折叠为一个空格,
/// 行尾空白丢弃;纯空白行归一为空行,保持空行结构
fn collapse_line(line: &str) -> String {
    let indent_len = line.len() - line.trim_start_matches([' ', '\t']).len();
    let (indent, rest) = line.split_at(indent_len);
    let body = rest.split_whitespace().collect::<Vec<_>>().join(" ");
    if body.is_empty() {
        String::new()
    } else {
        format!("{indent}{body}")
    }
}

/// 词字符:字母/数字(含汉字)与下划线;其余(含空白、标点)一律视为词边界
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// 存库前移除 #标签 词元:单遍扫描原文(词法同 extract_tags,共用 scan_tag_token),
/// 保留非标签段、丢弃标签 token、裸 # 保留;最后逐行归一空白并保留行结构与行首缩进
/// (多行笔记的换行、空行、嵌套列表/代码块的缩进原样保留;
/// 标签折叠进 tags/tag_links,原文保留会双重展示)
pub(crate) fn strip_tags(content: &str) -> String {
    let content = content.replace("\r\n", "\n"); // 统一换行,防 Windows 端混入 \r
    let mut out = String::new();
    let mut prev: Option<char> = None; // out 的末字符,用于判断 # 是否位于词首
    let mut chars = content.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '#' {
            out.push(c);
            prev = Some(c);
            continue;
        }
        if crate::tags::scan_tag_token(&mut chars).is_none() {
            out.push(c); // 裸 # 不属于标签,保留为内容
            prev = Some(c);
        } else if prev.is_none_or(|p| !is_word_char(p)) {
            // 仅当标签起始于行首或被非词字符分隔时,才吞掉其后的一个空格/制表符:
            // 消除行首标签剥离后的前导空白(不吞换行,否则会把下一行并上来)。
            // # 位于词中间(issue#123、URL 片段)时不得吞空白,否则相邻词会粘连成 issue修复
            if let Some(&next) = chars.peek() {
                if next == ' ' || next == '\t' {
                    chars.next();
                }
            }
        }
    }
    out.split('\n').map(collapse_line).collect::<Vec<_>>().join("\n")
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

pub(crate) fn map_note_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<NoteRow> {
    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
}

/// 相邻同 id 行折叠为一个 Note(tags 收集为列表),recent 与 query 共用
pub(crate) fn fold_tag_rows(rows: impl Iterator<Item = rusqlite::Result<NoteRow>>) -> rusqlite::Result<Vec<Note>> {
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

/// 读取单条完整笔记(含 tag_links 全量标签,按名升序);无该 id 返回 None。
/// update/toggle_todo 事务内重读共用。
pub(crate) fn read_full(conn: &Connection, id: i64) -> rusqlite::Result<Option<Note>> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.content, n.created_at, t.name
         FROM notes n
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         WHERE n.id = ?1 ORDER BY t.name",
    )?;
    let rows = stmt.query_map(params![id], map_note_row)?;
    Ok(fold_tag_rows(rows)?.into_iter().next())
}

/// 查询/更新拆分模块(守 200 行上限);re-export 保持 repos::notes::* 路径不变
#[path = "notes_query.rs"]
pub mod notes_query;
pub use notes_query::{count_tags, query, NoteFilter};

#[path = "notes_update.rs"]
pub mod notes_update;
pub use notes_update::{toggle_todo, update};

#[cfg(test)]
#[path = "notes_tests.rs"]
mod notes_tests;

#[cfg(test)]
#[path = "notes_strip_tests.rs"]
mod notes_strip_tests;
