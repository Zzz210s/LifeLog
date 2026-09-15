//! 笔记改期(自 notes.rs / notes_update.rs 拆出以守 200 行上限)。
//! 改期是"自愈"操作:解链该笔记的**全部**时间标签链接,再链到 `时间排序/YYYY/MM/DD`
//! (`ensure_path` 建树)—— 用户手打过多个时间标签时,改期后只剩一个,冲突状态自动消失。
//! 正文与其它标签一律不动;解链后变空的时间节点按既有策略回收(无链接且无子)。
use super::read_full;
use crate::db::repos::tags_tree;
use rusqlite::{params, Connection};

/// 解链某笔记的全部时间标签链接(含手打的多条;路径前缀用 substr 比较,禁 LIKE)
fn unlink_time_tags(tx: &rusqlite::Transaction<'_>, note_id: i64) -> rusqlite::Result<usize> {
    tx.execute(
        &format!(
            "DELETE FROM tag_links WHERE target_type='note' AND target_id=?1
               AND tag_id IN (SELECT id FROM tags WHERE {})",
            crate::timetag::sql_in_time_subtree("tags")
        ),
        params![note_id],
    )
}

/// 改期(单事务):校验日期 -> 解链全部时间标签 -> ensure_path + 链接 -> 回收空时间节点。
/// 返回改期后的完整笔记;id 不存在返回 None(事务回滚,什么都不改)。
/// 日期非法返回错误(命令层已先校验为中文提示,这里是防御性第二道,保证仓库层可独立使用)。
pub fn set_date(
    conn: &mut Connection,
    note_id: i64,
    date: &str,
) -> rusqlite::Result<Option<super::Note>> {
    let segs = crate::timetag::segments_for_date(date)
        .ok_or_else(|| rusqlite::Error::InvalidParameterName(format!("日期格式不正确: {date}")))?;
    let tx = conn.transaction()?;
    let exists: i64 = tx.query_row(
        "SELECT COUNT(*) FROM notes WHERE id=?1",
        params![note_id],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Ok(None); // 无该行:回滚空事务
    }
    unlink_time_tags(&tx, note_id)?;
    let tag_id = tags_tree::ensure_path(&tx, &segs)?;
    tags_tree::link_note(&tx, note_id, tag_id)?;
    tags_tree::gc_orphans(&tx)?;
    let note = read_full(&tx, note_id)?;
    tx.commit()?;
    Ok(note)
}
