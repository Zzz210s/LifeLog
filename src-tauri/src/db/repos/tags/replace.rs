//! 按 id 替换笔记链接(自 tags_tree.rs 拆出以守 200 行上限)。
//! S5 删掉切换待办后,唯一的调用方是 link_paths(按 path、带校验);
//! 曾经服务于待办的「按既有 tag_id 绕开校验」入口(resolve_id)已随命令一并删除。
use super::{gc_orphans, link_note};
use rusqlite::{params, Connection};

/// 按 id 集合替换笔记的链接(增量:只删多余的、只补缺失的),收尾精确回收孤儿。
/// link_paths(按 path、带校验)复用本函数完成同一套替换语义。
pub(crate) fn replace_links(conn: &Connection, note_id: i64, ids: &[i64]) -> rusqlite::Result<()> {
    let existing: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT tag_id FROM tag_links WHERE target_type = 'note' AND target_id = ?1")?;
        let rows = stmt.query_map(params![note_id], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<Vec<i64>>>()?
    };
    for tid in &existing {
        if !ids.contains(tid) {
            conn.execute(
                "DELETE FROM tag_links WHERE tag_id = ?1 AND target_type = 'note' AND target_id = ?2",
                params![tid, note_id],
            )?;
        }
    }
    for tid in ids {
        if !existing.contains(tid) {
            link_note(conn, note_id, *tid)?;
        }
    }
    gc_orphans(conn)
}
