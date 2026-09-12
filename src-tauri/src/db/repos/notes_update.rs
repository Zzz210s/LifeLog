//! notes 更新层(自 notes.rs 拆出以守 200 行上限):update/toggle_todo。
/// 替换语义沿用旧 diary 修订先例:先删旧链再写新链,最后回收无引用孤儿 tags。
use super::{read_full, strip_tags};
use rusqlite::{params, Connection};

/// 替换笔记标签集合(事务内):删旧链 -> 归一写新链 -> 清孤儿 tags。
/// tag_links 触发器负责将聚合结果同步进 FTS tags 列。
/// 006 起 tags 为树:此处沿用旧行为只建根级标签(父为空、路径=名称、深度=1)。
fn set_tags(tx: &rusqlite::Transaction<'_>, id: i64, names: &[String]) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM tag_links WHERE target_type='note' AND target_id=?1", params![id])?;
    for name in names {
        tx.execute(
            "INSERT OR IGNORE INTO tags(name, parent_id, path, depth) VALUES(?1, NULL, ?1, 1)",
            params![name],
        )?;
        let tid: i64 = tx.query_row(
            "SELECT id FROM tags WHERE name = ?1 AND parent_id IS NULL",
            params![name],
            |r| r.get(0),
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'note', ?2)",
            params![tid, id],
        )?;
    }
    tx.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM tag_links)",
        [],
    )?;
    Ok(())
}

/// 更新笔记正文(事务):剥离/提取标签后整条重存,链接为替换语义。
/// id 不存在返回 None;成功返回含全量标签的最新笔记。
pub fn update(conn: &mut Connection, id: i64, content: &str) -> rusqlite::Result<Option<super::Note>> {
    let names = crate::tags::extract_tags(content);
    let text = strip_tags(content);
    let tx = conn.transaction()?;
    let rows = tx.execute(
        "UPDATE notes SET content=?1, updated_at=datetime('now','localtime') WHERE id=?2",
        params![text, id],
    )?;
    if rows == 0 {
        return Ok(None); // 无该行:回滚空事务
    }
    set_tags(&tx, id, &names)?;
    let note = read_full(&tx, id)?;
    tx.commit()?;
    Ok(note)
}

/// 切换 #todo/#done:含 todo 换 done,含 done 换 todo,均无则原样返回不写库。
/// 仅改标签集合,正文字节不动;id 不存在返回 None。
pub fn toggle_todo(conn: &mut Connection, id: i64) -> rusqlite::Result<Option<super::Note>> {
    let current = match read_full(conn, id)? {
        Some(n) => n,
        None => return Ok(None),
    };
    let mut tags = current.tags.clone();
    if tags.iter().any(|t| t == "todo") {
        tags.retain(|t| t != "todo");
        tags.push("done".to_string());
    } else if tags.iter().any(|t| t == "done") {
        tags.retain(|t| t != "done");
        tags.push("todo".to_string());
    } else {
        return Ok(Some(current));
    }
    tags.sort(); // 与 read_full 的 ORDER BY t.name 序一致
    let tx = conn.transaction()?;
    set_tags(&tx, id, &tags)?;
    let note = read_full(&tx, id)?;
    tx.commit()?;
    Ok(note)
}

#[cfg(test)]
#[path = "notes_update_tests.rs"]
mod notes_update_tests;
