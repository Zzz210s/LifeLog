//! 合并时把源的子标签整棵搬到目标下(设计 2026-10-06 §6;路径物化见记忆 #989:
//! 只改 parent_id 会留脏 path,必须同时重写整棵子树的 path 并按层差调 depth)。
//! T4.1 起标签行在 `entities`(树内 = `path IS NOT NULL`)、父子真源在 `edges(kind='child')`:
//! 派生列与边同事务维护。
//! 与目标已有子标签 **`entity_key` 同键** 的先递归整棵并 —— 具体是否合并由
//! `auto_merge::merge_pair` 的三重闸门裁决(spec §3.6)。
use super::auto_merge::merge_pair;
use super::merge::sibling_by_name;
use rusqlite::{params, Connection};

/// 把 source 的直接子标签挂到 target 末尾,返回实际重挂的子标签 id(按原顺序)。
pub(crate) fn attach_children(
    conn: &Connection,
    source_id: i64,
    target_id: i64,
) -> Result<Vec<i64>, String> {
    // ① raw 同名兄弟递归整棵并(也走 merge_pair:每次自动合并都留一条日志)
    for (cid, name) in child_rows(conn, source_id)? {
        if let Some(existing) = sibling_by_name(conn, Some(target_id), &name, cid)? {
            merge_pair(conn, cid, existing)?;
        }
    }
    let remaining = child_ids(conn, source_id)?;
    if remaining.is_empty() {
        return Ok(remaining);
    }
    // ② 后代 depth 按层差整体平移(必须先于重挂:平移找的是 source 的子孙)
    let (src_depth, src_path) = depth_path(conn, source_id)?;
    let (dst_depth, dst_path) = depth_path(conn, target_id)?;
    shift_descendant_depths(conn, source_id, dst_depth - src_depth)?;
    // ③ 父子边整批改挂到目标(剩余子标签的入 child 边)
    conn.execute(
        "UPDATE edges SET source_id = ?2 WHERE kind = 'child' AND source_id = ?1",
        params![source_id, target_id],
    )
    .map_err(|e| e.to_string())?;
    // ④ 依次挂到目标末尾,保留彼此相对顺序
    let base: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM entities
             WHERE path IS NOT NULL AND parent_id = ?1",
            params![target_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    for (i, cid) in remaining.iter().enumerate() {
        conn.execute(
            "UPDATE entities SET parent_id = ?1, sort_order = ?2 WHERE id = ?3 AND path IS NOT NULL",
            params![target_id, base + i as i64, cid],
        )
        .map_err(|e| e.to_string())?;
    }
    // ⑤ 子树 path 前缀重写(只改后代,不含源自己 —— 源的 path 由调用方删除处理)
    conn.execute(
        "UPDATE entities SET path = ?2 || substr(path, length(?1) + 1)
         WHERE path IS NOT NULL
           AND length(path) > length(?1) AND substr(path, 1, length(?1) + 1) = ?1 || '/'",
        params![src_path, dst_path],
    )
    .map_err(|e| e.to_string())?;
    Ok(remaining)
}

fn child_rows(conn: &Connection, parent: i64) -> Result<Vec<(i64, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, entity_name(meta) FROM entities WHERE path IS NOT NULL AND parent_id = ?1
             ORDER BY sort_order, path",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![parent], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

fn child_ids(conn: &Connection, parent: i64) -> Result<Vec<i64>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id FROM entities WHERE path IS NOT NULL AND parent_id = ?1
             ORDER BY sort_order, path",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![parent], |r| r.get(0)).map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

fn depth_path(conn: &Connection, id: i64) -> Result<(i64, String), String> {
    conn.query_row(
        "SELECT depth, path FROM entities WHERE id = ?1 AND path IS NOT NULL",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .map_err(|e| format!("标签不存在: {id} ({e})"))
}

fn shift_descendant_depths(conn: &Connection, tag_id: i64, delta: i64) -> Result<(), String> {
    if delta == 0 {
        return Ok(());
    }
    conn.execute(
        "WITH RECURSIVE sub(id) AS (
           SELECT id FROM entities WHERE parent_id = ?1
           UNION ALL SELECT t.id FROM entities t JOIN sub s ON t.parent_id = s.id
         ) UPDATE entities SET depth = depth + ?2 WHERE id IN (SELECT id FROM sub)",
        params![tag_id, delta],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
