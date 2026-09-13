//! 标签树结构变更(自 tags_tree.rs 拆出以守 200 行上限):改名 / 移动 / 删除子树。
//! 写操作各自整事务提交,任一步失败整体回滚(path 重写与 FTS 刷新同事务)。
// Task 4 命令层接入前本模块暂无生产调用方,allow 只为守住 cargo check --lib 零警告
#![allow(dead_code)]
use super::path::{child_path, unique_conflict};
use super::{gc_orphans, linked_notes, refresh_fts, subtree_ids};
use rusqlite::{params, Connection, OptionalExtension};

/// 标签行(结构操作所需的最小字段集)
struct Node {
    name: String,
    parent_id: Option<i64>,
    path: String,
    depth: i64,
}

fn load(conn: &Connection, tag_id: i64) -> Result<Node, String> {
    conn.query_row(
        "SELECT name, parent_id, path, depth FROM tags WHERE id = ?1",
        params![tag_id],
        |r| {
            Ok(Node {
                name: r.get(0)?,
                parent_id: r.get(1)?,
                path: r.get(2)?,
                depth: r.get(3)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("标签不存在: {tag_id}"))
}

/// 同级重名校验:给出可读错误(唯一索引仍是兜底),避免无谓写库
fn ensure_sibling_free(
    conn: &Connection,
    parent: Option<i64>,
    name: &str,
    id: i64,
) -> Result<(), String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tags
             WHERE COALESCE(parent_id, 0) = COALESCE(?1, 0) AND name = ?2 AND id <> ?3",
            params![parent, name, id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n > 0 {
        return Err(format!("同级已有同名标签: {name}"));
    }
    Ok(())
}

/// 子树 path 整体重写:old 自身及其所有后代换成 new 前缀。
/// 不用 LIKE(名称可能含 %) —— substr 比较前缀、substr 截取剩余段。
fn rewrite_subtree_paths(conn: &Connection, old: &str, new: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tags SET path = ?2 || substr(path, length(?1) + 1)
         WHERE path = ?1
            OR (length(path) > length(?1) AND substr(path, 1, length(?1) + 1) = ?1 || '/')",
        params![old, new],
    )?;
    Ok(())
}

/// 子树(不含自身)深度整体顺延
fn shift_subtree_depths(conn: &Connection, tag_id: i64, delta: i64) -> rusqlite::Result<()> {
    if delta == 0 {
        return Ok(());
    }
    conn.execute(
        "WITH RECURSIVE sub(id) AS (
           SELECT id FROM tags WHERE parent_id = ?1
           UNION ALL SELECT t.id FROM tags t JOIN sub s ON t.parent_id = s.id
         ) UPDATE tags SET depth = depth + ?2 WHERE id IN (SELECT id FROM sub)",
        params![tag_id, delta],
    )?;
    Ok(())
}

/// 结构变更前收集受影响笔记:先取子树标签 id,再取这些标签链接到的笔记
fn subtree_note_ids(conn: &Connection, tag_id: i64) -> Result<Vec<i64>, String> {
    let ids = subtree_ids(conn, tag_id).map_err(|e| e.to_string())?;
    linked_notes(conn, &ids).map_err(|e| e.to_string())
}

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
    let new_path = child_path(&tx, node.parent_id, &new_name).map_err(|e| e.to_string())?;
    let notes = subtree_note_ids(&tx, tag_id)?;
    tx.execute("UPDATE tags SET name = ?1 WHERE id = ?2", params![new_name, tag_id])
        .map_err(|e| unique_conflict(e, "已存在同名标签"))?;
    rewrite_subtree_paths(&tx, &node.path, &new_path)
        .map_err(|e| unique_conflict(e, "已存在同名标签"))?;
    refresh_fts(&tx, &notes).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| unique_conflict(e, "已存在同名标签"))
}

/// 移动标签到新父级(None 为根级):环检测 + 深度上限 + 同级重名,全部通过才写。
pub fn move_to(conn: &mut Connection, tag_id: i64, new_parent: Option<i64>) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let node = load(&tx, tag_id)?;
    if node.parent_id == new_parent {
        return Ok(()); // 无变化:回滚空事务
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
    let new_path = child_path(&tx, new_parent, &node.name).map_err(|e| e.to_string())?;
    let notes = linked_notes(&tx, &ids).map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE tags SET parent_id = ?1, path = ?2, depth = ?3 WHERE id = ?4",
        params![new_parent, new_path, new_depth, tag_id],
    )
    .map_err(|e| unique_conflict(e, "该层级下已有同名标签"))?;
    rewrite_subtree_paths(&tx, &node.path, &new_path)
        .map_err(|e| unique_conflict(e, "该层级下已有同名标签"))?;
    shift_subtree_depths(&tx, tag_id, delta).map_err(|e| e.to_string())?;
    refresh_fts(&tx, &notes).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| unique_conflict(e, "该层级下已有同名标签"))
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
    refresh_fts(&tx, &notes).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
