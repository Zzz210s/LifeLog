//! 按 id 替换笔记链接(自 tags_tree.rs 拆出以守 200 行上限)。
//! S5 删掉切换待办后,唯一的调用方是 link_paths(按 path、带校验);
//! 曾经服务于待办的「按既有 tag_id 绕开校验」入口(resolve_id)已随命令一并删除。

/// 按 id 集合替换笔记的引用(增量:只删多余的、只补缺失的),收尾精确回收孤儿。
/// FTS 重写由 `edges_ai`/`edges_ad` 触发器负责(本函数只动 `edges`)。
/// 统一元数据(v28)后目标边都是 `link`,本函数只用于标签路径解析后的落库(标签们);
/// 笔记保存路径的「标签 + 链接并集」由 `note_links::replace_ids` 一次完成。
/// 唯一调用方是 §测试专用§ 的 `link_paths`,故随之一并入 `cfg(test)`。
#[cfg(test)]
pub(crate) fn replace_links(
    conn: &rusqlite::Connection,
    note_id: i64,
    ids: &[i64],
) -> rusqlite::Result<()> {
    use rusqlite::params;

    use super::{gc_orphans, link_note};
    let existing: Vec<i64> = {
        let mut stmt = conn.prepare(
            "SELECT target_id FROM edges WHERE kind = 'link' AND source_id = ?1",
        )?;
        let rows = stmt.query_map(params![note_id], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<Vec<i64>>>()?
    };
    for tid in &existing {
        if !ids.contains(tid) {
            conn.execute(
                "DELETE FROM edges WHERE kind = 'link' AND source_id = ?2 AND target_id = ?1",
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
