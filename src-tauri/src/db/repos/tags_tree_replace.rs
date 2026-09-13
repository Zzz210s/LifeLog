//! 按 id 替换笔记链接(自 tags_tree.rs 拆出以守 200 行上限)。
//! 切换待办等场景读回的是库里的完整 path,而 006 原样保留了名称含 '.'/'·'/空格/'/' 的
//! 存量标签(新语法不再产生这类名字);这些 path 不可解析,不能过 link_paths 的校验,
//! 否则「切换待办」会在存量数据上直接失败。故对不可解析的 path 直接沿用既有 tag_id。
use super::{ensure_path, gc_orphans, link_note};
use rusqlite::{params, Connection, OptionalExtension};

/// path -> tag_id:可解析的按新语义建/复用节点(自动建父级);不可解析的沿用库里既有行。
/// 库里没有该 path 即报错(不静默丢弃,避免"存一次丢一个标签")。
pub(crate) fn resolve_id(conn: &Connection, path: &str) -> rusqlite::Result<i64> {
    if let Some(segs) = crate::tags::parse_tag_path(path) {
        return ensure_path(conn, &segs);
    }
    conn.query_row("SELECT id FROM tags WHERE path = ?1", params![path], |r| r.get(0))
        .optional()?
        .ok_or_else(|| rusqlite::Error::InvalidParameterName(format!("未知标签: {path}")))
}

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
