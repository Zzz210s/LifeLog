//! 标签树结构变更(自 tags_tree.rs 拆出以守 200 行上限):改名 / 移动 / 删除子树。
//! 写操作各自整事务提交,任一步失败整体回滚(path 重写、标签页条件级联与 FTS 刷新同事务)。
//! 时间标签已是普通标签(D3):不再有"时间子树不可改名/移动/删除"的守卫。
//! 底层 SQL 动作见 tags_tree_ops_sql。
use super::ops_sql::{
    apply_sibling_order, ensure_sibling_free, load, rewrite_subtree_paths, shift_subtree_depths,
    subtree_note_ids, Anchor,
};
use super::{gc_orphans, linked_notes, refresh_fts, subtree_ids};
use crate::db::repos::tabs_rewrite;
use rusqlite::{params, Connection, OptionalExtension};

/// 改标签名:校验 -> 同级重名 -> 子树 path 前缀重写 -> 受影响笔记 FTS 重写。整事务。
pub fn rename(conn: &mut Connection, tag_id: i64, new_name: &str) -> Result<(), String> {
    let segs = crate::tags::parse_tag_path(new_name)
        .filter(|s| s.len() == 1)
        .ok_or_else(|| format!("标签名不合法: {new_name}"))?;
    let new_name = segs[0].clone();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let node = load(&tx, tag_id)?;
    if node.name == new_name {
        return Ok(()); // 无变化:回滚空事务
    }
    ensure_sibling_free(&tx, node.parent_id, &new_name, tag_id)?;
    // 新路径从父节点派生(存量平铺根的 path 可能与 name 不一致,不能用自身旧 path 派生)
    let new_path = super::path::child_path(&tx, node.parent_id, &new_name).map_err(|e| e.to_string())?;
    let notes = subtree_note_ids(&tx, tag_id)?;
    tx.execute("UPDATE tags SET name = ?1 WHERE id = ?2", params![new_name, tag_id])
        .map_err(|e| super::path::unique_conflict(e, "已存在同名标签"))?;
    rewrite_subtree_paths(&tx, &node.path, &new_path)
        .map_err(|e| super::path::unique_conflict(e, "已存在同名标签"))?;
    tabs_rewrite::rewrite_prefix(&tx, &node.path, &new_path).map_err(|e| e.to_string())?;
    refresh_fts(&tx, &notes).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| super::path::unique_conflict(e, "已存在同名标签"))
}

/// 移动标签到新父级(None 为根级):追加到新父级最后一个兄弟之后(右键菜单的口径)
pub fn move_to(conn: &mut Connection, tag_id: i64, new_parent: Option<i64>) -> Result<(), String> {
    move_to_ordered(conn, tag_id, new_parent, None)
}

/// 移动标签到新父级(None 为根级):环检测 + 深度上限 + 同级重名,全部通过才写。
/// 末尾与 delete_subtree/link_paths 一致地回收空容器:移走最后的子节点后,旧父级会
/// 变成"无链接且无子节点"的空标签,不回收就会在标签面板里残留。
/// anchor 为同理插入位置(S8):Some 时插到指定兄弟的前/后,None 时追加到末层末尾。
pub fn move_to_ordered(
    conn: &mut Connection,
    tag_id: i64,
    new_parent: Option<i64>,
    anchor: Option<Anchor>,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let node = load(&tx, tag_id)?;
    if node.parent_id == new_parent && anchor.is_none() {
        // 无变化:回滚空事务。带锚点时即使父级不变也要继续 —— 同级重排就是这种输入。
        return Ok(());
    }
    let ids = subtree_ids(&tx, tag_id).map_err(|e| e.to_string())?;
    let new_depth = match new_parent {
        None => 1,
        Some(p) => {
            if ids.contains(&p) {
                return Err("不能移动到自身或其子孙下".into());
            }
            let parent_depth: i64 = tx
                .query_row("SELECT depth FROM tags WHERE id = ?1", params![p], |r| r.get(0))
                .optional()
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("目标父标签不存在: {p}"))?;
            parent_depth + 1
        }
    };
    let delta = new_depth - node.depth;
    let max_sub: i64 = tx
        .query_row(
            "WITH RECURSIVE sub(id, depth) AS (
               SELECT id, depth FROM tags WHERE id = ?1
               UNION ALL SELECT t.id, t.depth FROM tags t JOIN sub s ON t.parent_id = s.id
             ) SELECT COALESCE(MAX(depth), 0) FROM sub",
            params![tag_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if max_sub + delta > crate::tags::max_depth() as i64 {
        return Err(format!("层级过深:最多 {} 级", crate::tags::max_depth()));
    }
    ensure_sibling_free(&tx, new_parent, &node.name, tag_id)?;
    let new_path = super::path::child_path(&tx, new_parent, &node.name).map_err(|e| e.to_string())?;
    let notes = linked_notes(&tx, &ids).map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE tags SET parent_id = ?1, path = ?2, depth = ?3 WHERE id = ?4",
        params![new_parent, new_path, new_depth, tag_id],
    )
    .map_err(|e| super::path::unique_conflict(e, "该层级下已有同名标签"))?;
    rewrite_subtree_paths(&tx, &node.path, &new_path)
        .map_err(|e| super::path::unique_conflict(e, "该层级下已有同名标签"))?;
    shift_subtree_depths(&tx, tag_id, delta).map_err(|e| e.to_string())?;
    // 同层次序(S8):插到锚点位置后整层重写 sort_order;锚点 None = 追加到末尾
    apply_sibling_order(&tx, new_parent, tag_id, anchor)?;
    tabs_rewrite::rewrite_prefix(&tx, &node.path, &new_path).map_err(|e| e.to_string())?;
    gc_orphans(&tx).map_err(|e| e.to_string())?;
    refresh_fts(&tx, &notes).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| super::path::unique_conflict(e, "该层级下已有同名标签"))
}

/// 同级插入(S8):把 tag_id 移到锚点所在的父级下,插到锚点之前(after=false)/之后(after=true)。
/// 锚点 = 自身时无操作(拖到自己前面/后面);新的父级从锚点派生,而锚点的存在性由 load 校验。
pub fn move_beside(
    conn: &mut Connection,
    tag_id: i64,
    anchor_id: i64,
    after: bool,
) -> Result<(), String> {
    if tag_id == anchor_id {
        return Ok(());
    }
    let parent = load(conn, anchor_id)?.parent_id;
    move_to_ordered(conn, tag_id, parent, Some(Anchor { id: anchor_id, after }))
}

/// 删除子树:先解链再删标签,最后按剩余链接重写受影响笔记的 FTS。整事务,失败回滚。
/// 末尾与 link_paths 一致地回收空容器:祖先可能因此变成"无链接且无子节点"的空标签,
/// 不回收就会在标签面板里时有时无地残留。
pub fn delete_subtree(conn: &mut Connection, tag_id: i64) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let ids = subtree_ids(&tx, tag_id).map_err(|e| e.to_string())?;
    if ids.is_empty() {
        return Err(format!("标签不存在: {tag_id}"));
    }
    let notes = linked_notes(&tx, &ids).map_err(|e| e.to_string())?;
    let marks = vec!["?"; ids.len()].join(",");
    let args = || rusqlite::params_from_iter(ids.iter());
    tx.execute(
        &format!("DELETE FROM tag_links WHERE target_type = 'note' AND tag_id IN ({marks})"),
        args(),
    )
    .map_err(|e| e.to_string())?;
    // tag_links 触发器已按"链接移除后"的聚合重写 FTS,此处再显式重写一次兜底
    tx.execute(&format!("DELETE FROM tags WHERE id IN ({marks})"), args())
        .map_err(|e| e.to_string())?;
    gc_orphans(&tx).map_err(|e| e.to_string())?;
    // 删除标签**不**重写 tabs_state 条件(S7):已删路径的标签页自然筛不出笔记,由用户自行调整。
    refresh_fts(&tx, &notes).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
