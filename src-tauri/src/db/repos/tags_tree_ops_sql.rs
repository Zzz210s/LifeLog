//! 标签树结构变更的底层动作(自 tags_tree_ops.rs 拆出以守 200 行上限):
//! 结构操作所需的最小行读取、同级重名校验、子树 path/depth 重写、受影响笔记收集。
//! 全部函数式(接收 `&Connection`),事务由调用方(tags_tree_ops)打开。
use rusqlite::{params, Connection, OptionalExtension};

/// 标签行(结构操作所需的最小字段集)
pub(crate) struct Node {
    pub name: String,
    pub parent_id: Option<i64>,
    pub path: String,
    pub depth: i64,
}

/// 读取单个标签行;不存在时报中文错(界面直接展示)
pub(crate) fn load(conn: &Connection, tag_id: i64) -> Result<Node, String> {
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
pub(crate) fn ensure_sibling_free(
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
pub(crate) fn rewrite_subtree_paths(conn: &Connection, old: &str, new: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tags SET path = ?2 || substr(path, length(?1) + 1)
         WHERE path = ?1
            OR (length(path) > length(?1) AND substr(path, 1, length(?1) + 1) = ?1 || '/')",
        params![old, new],
    )?;
    Ok(())
}

/// 子树(不含自身)深度整体顺延
pub(crate) fn shift_subtree_depths(conn: &Connection, tag_id: i64, delta: i64) -> rusqlite::Result<()> {
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
pub(crate) fn subtree_note_ids(conn: &Connection, tag_id: i64) -> Result<Vec<i64>, String> {
    let ids = super::subtree_ids(conn, tag_id).map_err(|e| e.to_string())?;
    super::linked_notes(conn, &ids).map_err(|e| e.to_string())
}

/// 同级落点锚点(S8):插到 siblings 里 `id` 这个兄弟的之前/之后
#[derive(Debug, Clone, Copy)]
pub(crate) struct Anchor {
    pub id: i64,
    pub after: bool,
}

/// 同层次序(S8):兄弟序 = (sort_order, path)。把 tag_id 插到锚点位置后整层重写
/// sort_order = 0..n-1 —— 其它兄弟的相对次序不变(按原序重新编号)。
/// 锚点 None(右键移动/成为子级)追加到末尾;锚点不在列表里(自身/已被排除)也按追加。
pub(crate) fn apply_sibling_order(
    conn: &Connection,
    parent: Option<i64>,
    tag_id: i64,
    anchor: Option<Anchor>,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT id FROM tags WHERE COALESCE(parent_id, 0) = COALESCE(?1, 0) AND id <> ?2
             ORDER BY sort_order, path",
        )
        .map_err(|e| e.to_string())?;
    let siblings: Vec<i64> = stmt
        .query_map(params![parent, tag_id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    let idx = match anchor {
        None => siblings.len(),
        Some(a) => match siblings.iter().position(|&x| x == a.id) {
            Some(p) => {
                if a.after {
                    p + 1
                } else {
                    p
                }
            }
            None => siblings.len(),
        },
    };
    let mut ordered = siblings;
    ordered.insert(idx.min(ordered.len()), tag_id);
    for (i, id) in ordered.iter().enumerate() {
        conn.execute(
            "UPDATE tags SET sort_order = ?2 WHERE id = ?1",
            params![id, i as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
