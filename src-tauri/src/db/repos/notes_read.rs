//! 笔记读取层(自 notes.rs 拆出以守 200 行上限):行映射与折叠、单条读回、最近 N 条、删除。
//! 每条笔记除了标签路径(LEFT JOIN 展开成多行),没有其它派生列 —— 时间标签已是普通标签,与其它标签同列。
use super::Note;
use rusqlite::{params, Connection};

/// 行映射:note 基础列 + 可空标签路径
type NoteRow = (i64, String, String, Option<String>);

/// 四个 SELECT 列(所有读取路径共用同一形状):id/正文/created_at/标签路径。
fn columns() -> &'static str {
    "n.id, n.content, n.created_at, t.path"
}

/// 行映射(列顺序见 [`columns`])
pub(crate) fn map_note_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<NoteRow> {
    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
}

/// 相邻同 id 行折叠为一个 Note(tags 收集为列表),recent 与 query 共用。
pub(crate) fn fold_tag_rows(
    rows: impl Iterator<Item = rusqlite::Result<NoteRow>>,
) -> rusqlite::Result<Vec<Note>> {
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

/// 最近 N 条(id 降序,含全部标签)。当前仅测试使用,生产路径走 query;
/// 标 #[cfg(test)] 以消除非 test 构建的 dead_code 警告。
#[cfg(test)]
pub fn recent(conn: &Connection, limit: u32) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM notes n
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         WHERE n.id IN (SELECT id FROM notes ORDER BY id DESC LIMIT ?1)
         ORDER BY n.id DESC, t.path",
        columns()
    ))?;
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
/// 路径是树语义真源(同名末级可能出现在多个父级下),update/create 事务内共用。
pub(crate) fn read_full(conn: &Connection, id: i64) -> rusqlite::Result<Option<Note>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM notes n
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         WHERE n.id = ?1 ORDER BY t.path",
        columns()
    ))?;
    let rows = stmt.query_map(params![id], map_note_row)?;
    Ok(fold_tag_rows(rows)?.into_iter().next())
}
