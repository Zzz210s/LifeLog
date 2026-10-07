//! 删除标签子树(自 ops.rs 拆出以守 200 行上限)。
//! 先清边再删实体,最后按剩余链接重写受影响笔记的 FTS;整事务,失败回滚。
//! 末尾与 link_paths 一致地回收空容器:祖先可能因此变成"无链接且无子节点"的空标签,
//! 不回收就会在标签面板里时有时无地残留。
use super::{linked_notes, subtree_ids};
use crate::db::repos::tags::{finish, PostWrite};
use rusqlite::Connection;

/// 删除子树:先解链再删标签,最后按剩余链接重写受影响笔记的 FTS。
pub fn delete_subtree(conn: &mut Connection, tag_id: i64) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let ids = subtree_ids(&tx, tag_id).map_err(|e| e.to_string())?;
    if ids.is_empty() {
        return Err(format!("标签不存在: {tag_id}"));
    }
    let notes = linked_notes(&tx, &ids).map_err(|e| e.to_string())?;
    let marks = vec!["?"; ids.len()].join(",");
    // 两端外键虽会级联,但夹具/旧库可能未开 FK:显式清边,不依赖 CASCADE
    let mut args = ids.clone();
    args.extend_from_slice(&ids);
    tx.execute(
        &format!("DELETE FROM edges WHERE source_id IN ({marks}) OR target_id IN ({marks})"),
        rusqlite::params_from_iter(args.iter()),
    )
    .map_err(|e| e.to_string())?;
    // 删除标签**不**重写 filter_current 条件(S7):已删路径自然筛不出笔记,由用户自行调整。
    tx.execute(
        &format!("DELETE FROM entities WHERE id IN ({marks})"),
        rusqlite::params_from_iter(ids.iter()),
    )
    .map_err(|e| e.to_string())?;
    // 实体行已删:实体的 FTS 行由 026 的 entities_ad 触发器清理
    finish(&tx, PostWrite { notes: &notes, entities: &[], path_change: None, gc: true })
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
