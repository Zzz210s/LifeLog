//! 删除标签子树(自 ops.rs 拆出以守 200 行上限)。
//! 先清边再删实体,最后按剩余链接重写受影响笔记的 FTS;整事务,失败回滚。
//! 末尾与 link_paths 一致地回收空容器:祖先可能因此变成"无链接且无子节点"的空标签,
//! 不回收就会在标签面板里时有时无地残留。
use super::subtree_ids;
use crate::db::repos::entities::reserved::TREE_NAME_ID;
use crate::db::repos::tags::{finish, PostWrite};
use rusqlite::Connection;

/// 删除子树:先解链再删标签,最后按剩余链接重写受影响笔记的 FTS。
/// `子级` 保留点(`id = 0`)命令层拒绝删除(spec §6.2 第一层防护)。
pub fn delete_subtree(conn: &mut Connection, tag_id: i64) -> Result<(), String> {
    if tag_id == TREE_NAME_ID {
        return Err("「子级」是树结构的保留名字点,不能删除".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let ids = subtree_ids(&tx, tag_id).map_err(|e| e.to_string())?;
    if ids.is_empty() {
        return Err(format!("标签不存在: {tag_id}"));
    }
    let marks = vec!["?"; ids.len()].join(",");
    // 两端外键虽会级联,但夹具/旧库可能未开 FK:显式清边,不依赖 CASCADE
    let mut args = ids.clone();
    args.extend_from_slice(&ids);
    // 被删线引用的名字点可能失去最后引用:先登记,交给 finish 的 GC 核对回收(T3.3)
    let name_ids: Vec<i64> = {
        let mut stmt = tx
            .prepare(&format!(
                "SELECT DISTINCT name_id FROM lines
                  WHERE name_id IS NOT NULL AND (from_id IN ({marks}) OR to_id IN ({marks}))"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(args.iter()), |r| r.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
    };
    for nid in name_ids {
        super::queue_name_point_gc(&tx, nid).map_err(|e| e.to_string())?;
    }
    tx.execute(
        &format!("DELETE FROM lines WHERE from_id IN ({marks}) OR to_id IN ({marks})"),
        rusqlite::params_from_iter(args.iter()),
    )
    .map_err(|e| e.to_string())?;
    // 删除标签**不**重写 filter_current 条件(S7):已删路径自然筛不出笔记,由用户自行调整。
    tx.execute(
        &format!("DELETE FROM points WHERE id IN ({marks})"),
        rusqlite::params_from_iter(ids.iter()),
    )
    .map_err(|e| e.to_string())?;
    // 点行已删:点的 FTS 行由 031 的 points_ad 触发器清理
    finish(&tx, PostWrite { entities: &[], path_change: None, gc: true })
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
