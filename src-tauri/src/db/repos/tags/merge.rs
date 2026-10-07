//! 标签合并仓库层(设计 2026-10-06 §6 改写):把源标签**整棵**并进目标 ——
//! 笔记链接取并集、子标签整棵搬、出边/入边取并集、源删除,可选把源旧路径登记为目标的别名。
//! 单事务:校验失败或任一步出错都整体回滚 —— 失败时数据库零变化。
//! 语义边界:目标不得落在源标签子树内(否则合并后语义自指);
//! 旧行为「源还有子标签就拒绝」已按设计取消(现在整棵并,见 merge_children)。
use super::alias;
use super::merge_children::attach_children;
use super::merge_edges::union_edges;
use super::tree::{linked_notes, subtree_ids};
use super::{finish_core, PostWrite};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// 合并读数(前端 G3 直接消费:camelCase 键 movedLinks / affectedNotes / aliases)
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    /// 实际转移的链接行数:目标已有同一笔记的链接时被主键约束挡下,不计入
    pub moved_links: i64,
    /// 合并前挂在源标签**整棵子树**上的去重笔记数
    pub affected_notes: i64,
    /// keep_alias 为真时实际登记的别名(旧完整路径在前、旧叶子名在后)
    pub aliases: Vec<String>,
}

/// 合并标签(命令层入口):整事务执行 [`merge_core`],收尾再跑一次同父同名自动合并
/// (合并本身可能让目标的子级与既有子级重名)。
pub fn merge_tags(
    conn: &mut Connection,
    source_id: i64,
    target_id: i64,
    keep_alias: bool,
) -> Result<MergeReport, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let report = merge_core(&tx, source_id, target_id, keep_alias)?;
    super::auto_merge::sweep(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(report)
}

/// 在调用方事务内把 source 整棵并进 target:校验 -> 子标签搬 -> 笔记链接并 -> 关系边并
/// -> 清源残余 -> 可选别名 -> 删源 -> 收尾(路径级联 / FTS / 孤儿回收)。不提交、不开事务。
pub(crate) fn merge_core(
    conn: &Connection,
    source_id: i64,
    target_id: i64,
    keep_alias: bool,
) -> Result<MergeReport, String> {
    let source_path = path_of(conn, source_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("源标签不存在: {source_id}"))?;
    let target_path = path_of(conn, target_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("目标标签不存在: {target_id}"))?;
    if source_id == target_id {
        return Err("不能把标签合并到它自己".into());
    }
    let ids = subtree_ids(conn, source_id).map_err(|e| e.to_string())?;
    if ids.contains(&target_id) {
        return Err("目标标签在源标签的子树内,不能合并".into());
    }
    // 受影响笔记要覆盖整棵子树(子标签搬走后它们的 FTS 标签列跟着变)
    let notes = linked_notes(conn, &ids).map_err(|e| e.to_string())?;
    let affected_notes = notes.len() as i64;
    // ① 子标签整棵搬(path/depth 同步重写;raw 同名兄弟递归并)
    attach_children(conn, source_id, target_id)?;
    // ② 笔记链接整行转移:目标已有同一笔记的链接时被主键挡下,不计入 movedLinks
    conn.execute(
        "UPDATE OR IGNORE edges SET target_id = ?1 WHERE kind = 'tagging' AND target_id = ?2",
        params![target_id, source_id],
    )
    .map_err(|e| e.to_string())?;
    let moved_links = conn.changes() as i64;
    // ③ 出边/入边取并集(会成环/变自环的边按 R3 剔除)
    union_edges(conn, source_id, target_id)?;
    // ④ 清掉源残余的边(被 IGNORE 的重复笔记链接 + 被剔除的关系边 + 源的入 child 边)
    conn.execute(
        "DELETE FROM edges WHERE kind = 'tagging' AND target_id = ?1",
        params![source_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM edges WHERE kind = 'relation' AND (source_id = ?1 OR target_id = ?1)",
        params![source_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM edges WHERE kind = 'child' AND target_id = ?1",
        params![source_id],
    )
    .map_err(|e| e.to_string())?;
    // ⑤ 旧名登记为别名(D6):旧完整路径 + 不冲突的旧叶子名
    let aliases = if keep_alias {
        alias::register_rename(conn, &source_path, target_id).map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };
    // ⑥ 删除源标签实体(外键级联兜底清理残余边)
    conn.execute("DELETE FROM entities WHERE id = ?1 AND kind = 'tag'", params![source_id])
        .map_err(|e| e.to_string())?;
    // ⑦ 统一收尾:筛选条件级联 -> 受影响笔记 FTS 重写 -> 孤儿回收
    finish_core(
        conn,
        PostWrite {
            entities: &ids,
            path_change: Some((source_path.as_str(), target_path.as_str())),
            gc: true,
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(MergeReport {
        moved_links,
        affected_notes,
        aliases,
    })
}

/// 标签路径;不存在返回 None(供"标签不存在"中文报错)
fn path_of(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT path FROM entities WHERE id = ?1 AND kind = 'tag'",
        params![id],
        |r| r.get(0),
    )
    .optional()
}

/// 同一父下 raw 同名(唯一索引口径)的兄弟 id;没有返回 None。
/// 供 rename / move 撞名时改走自动合并,以及 merge_children 的递归整棵并。
pub(crate) fn sibling_by_name(
    conn: &Connection,
    parent: Option<i64>,
    name: &str,
    exclude: i64,
) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM entities
         WHERE kind = 'tag' AND COALESCE(parent_id, 0) = COALESCE(?1, 0) AND name = ?2 AND id <> ?3
         ORDER BY id LIMIT 1",
        params![parent, name, exclude],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "tree_merge_tests.rs"]
mod tree_merge_tests;

#[cfg(test)]
#[path = "tree_merge_extra_tests.rs"]
mod tree_merge_extra_tests;
