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

/// 存库前移除 #标签 词元:用 `tags::tag_spans`(与 extract_tags 同一解析器)定位
/// **确认合法**的标签区间并只剥离这些区间;结构非法的 # 写法(如 `#工作/`、`#a//b`、`##标题`、
/// 行内/围栏代码块里的 #、`\#`)整串原样保留;空白/标点只是正常终止标签,不使其作废。
/// 起始于行首或紧跟空白之后的标签,额外吞掉其后的连续空格/制表符(不吞换行);
/// 最后逐行归一空白并保留行结构与行首缩进(多行笔记的换行、空行、嵌套列表缩进原样保留;
/// 标签折叠进 tags/tag_links,原文保留会双重展示)
pub(crate) fn strip_tags(content: &str) -> String {
    let content = content.replace("\r\n", "\n"); // 统一换行,防 Windows 端混入 \r
    let mut out = String::new();
    let mut cursor = 0usize;
    for span in crate::tags::tag_spans(&content) {
        out.push_str(&content[cursor..span.start]);
        // 仅当标签起始于行首或紧跟空白之后,才吞掉其后的连续空格/制表符:
        // 行首标签剥离后不留残余空白被误当缩进;
        // 行中标签(前面是词或标点)必须保留分隔空白,否则 "a-#tag b" 会粘连成 "a-b"、
        // "版本(#v2 备注)" 会粘连成 "版本(备注)",相邻文本被并成一个词(语义被改)。
        // 只吞空格/制表符,不吞换行,否则会把下一行并上来。
        let leading = out.chars().next_back().is_none_or(char::is_whitespace);
        cursor = span.end;
        if leading {
            while matches!(content[cursor..].chars().next(), Some(' ' | '\t')) {
                cursor += 1;
            }
        }
    }
    out.push_str(&content[cursor..]);
    out.split('\n').map(collapse_line).collect::<Vec<_>>().join("\n")
}

pub fn create(conn: &mut Connection, content: &str) -> rusqlite::Result<Note> {
    let names = crate::tags::extract_tags(content);
    let text = strip_tags(content);
    let tx = conn.transaction()?;
    tx.execute("INSERT INTO notes(content) VALUES(?1)", params![text])?;
    let id = tx.last_insert_rowid();
    // 006 起 tags 为树:按路径自动建父级并做增量链接(孤儿回收已收窄为"无链接且无子")
    crate::db::repos::tags_tree::link_paths(&tx, id, &names)?;
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

/// 最近 N 条(id 降序,含标签)。当前仅测试使用,生产路径走 query;
/// 标 #[cfg(test)] 以消除非 test 构建的 dead_code 警告。
#[cfg(test)]
pub fn recent(conn: &Connection, limit: u32) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.content, n.created_at, t.path
         FROM notes n
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         WHERE n.id IN (SELECT id FROM notes ORDER BY id DESC LIMIT ?1)
         ORDER BY n.id DESC, t.path",
    )?;
    let rows = stmt.query_map(params![limit], map_note_row)?;
    fold_tag_rows(rows)
}

/// 删除笔记(事务):先删 tag_links 再删 note,最后精确回收"无链接且无子节点"的孤儿标签
/// (父节点天生没有 tag_links 行,旧实现的"无链接即孤儿"会连带删掉整棵子树)。
pub fn delete(conn: &mut Connection, id: i64) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM tag_links WHERE target_type='note' AND target_id=?1", params![id])?;
    tx.execute("DELETE FROM notes WHERE id=?1", params![id])?;
    crate::db::repos::tags_tree::gc_orphans(&tx)?;
    tx.commit()
}

/// 读取单条完整笔记(含 tag_links 全量标签的**完整路径**,按 path 升序);无该 id 返回 None。
/// 路径是树语义真源(同名末级可能出现在多个父级下),update/toggle_todo 事务内重读共用。
pub(crate) fn read_full(conn: &Connection, id: i64) -> rusqlite::Result<Option<Note>> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.content, n.created_at, t.path
         FROM notes n
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         WHERE n.id = ?1 ORDER BY t.path",
    )?;
    let rows = stmt.query_map(params![id], map_note_row)?;
    Ok(fold_tag_rows(rows)?.into_iter().next())
}

/// 条件对象(结构化筛选真源)与条件 -> SQL 片段生成 / 校验
#[path = "notes_filter.rs"]
pub mod notes_filter;
pub use notes_filter::{validate as validate_conditions, FilterConditions};

/// 查询/更新拆分模块(守 200 行上限);re-export 保持 repos::notes::* 路径不变
#[path = "notes_query.rs"]
pub mod notes_query;
pub use notes_query::{count_tags, query};

#[path = "notes_update.rs"]
pub mod notes_update;
pub use notes_update::{toggle_todo, update};

#[cfg(test)]
#[path = "notes_filter_tests.rs"]
mod notes_filter_tests;

#[cfg(test)]
#[path = "notes_tests.rs"]
mod notes_tests;

#[cfg(test)]
#[path = "notes_strip_tests.rs"]
mod notes_strip_tests;
