//! 标签合并仓库层(spec 2026-09-20 §3.4 / D5-D7):把源标签的全部笔记链接转移给目标标签,
//! 可选把源标签旧路径登记为目标标签的别名,级联改写标签页条件,最后删除源标签。
//! 单事务:校验失败或任一步出错都整体回滚 —— 失败时数据库零变化。
//! 语义边界(D5):源标签必须无子节点(子树层级如何映射到目标没有唯一正解,先不做);
//! 目标标签不得落在源标签子树内(否则合并后语义自指)。
use super::tree::{linked_notes, subtree_ids};
use super::alias;
use crate::db::repos::tags::{finish, PostWrite};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// 合并读数(前端 G3 直接消费:camelCase 键 movedLinks / affectedNotes / aliases)
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    /// 实际转移的链接行数:目标已有同一笔记的链接时被主键约束挡下,不计入
    pub moved_links: i64,
    /// 合并前挂在源标签上的**去重**笔记数
    pub affected_notes: i64,
    /// keep_alias 为真时实际登记的别名(旧完整路径在前、旧叶子名在后)
    pub aliases: Vec<String>,
}

/// 合并标签:校验 -> 转移链接 -> 清重复行 -> 可选登记别名 -> 删除源标签
/// -> 统一收尾(tags_write::finish:路径级联 -> FTS 重写 -> 孤儿回收)。整事务提交。
pub fn merge_tags(
    conn: &mut Connection,
    source_id: i64,
    target_id: i64,
    keep_alias: bool,
) -> Result<MergeReport, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // ① 校验:全部通过才动数据(任一失败直接返回,事务 drop 即回滚)
    let source_path = path_of(&tx, source_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("源标签不存在: {source_id}"))?;
    let target_path = path_of(&tx, target_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("目标标签不存在: {target_id}"))?;
    if source_id == target_id {
        return Err("不能把标签合并到它自己".into());
    }
    // 子树检查先于子节点检查:目标在源子树内时给更精确的诊断
    if subtree_ids(&tx, source_id)
        .map_err(|e| e.to_string())?
        .contains(&target_id)
    {
        return Err("目标标签在源标签的子树内,不能合并".into());
    }
    if has_children(&tx, source_id).map_err(|e| e.to_string())? {
        return Err("该标签还有子标签,请先移走或合并子标签".into());
    }
    // ② 受影响笔记(源无子节点,子树即它自己)与后续要重写 FTS 的笔记集
    let notes = linked_notes(&tx, &[source_id]).map_err(|e| e.to_string())?;
    let affected_notes = notes.len() as i64;
    // ③ 转移链接:目标已有同一笔记链接的行被主键 (tag_id, target_type, target_id) IGNORE
    tx.execute(
        "UPDATE OR IGNORE tag_links SET tag_id = ?1 WHERE tag_id = ?2",
        params![target_id, source_id],
    )
    .map_err(|e| e.to_string())?;
    let moved_links = tx.changes() as i64;
    // ④ 清掉被 IGNORE 的重复行(删链接会触发 tag_links_ad,按剩余链接重写这些笔记的 FTS)
    tx.execute("DELETE FROM tag_links WHERE tag_id = ?1", params![source_id])
        .map_err(|e| e.to_string())?;
    // ⑤ 旧名登记为别名(D6):旧完整路径 + 不冲突的旧叶子名
    let aliases = if keep_alias {
        alias::register_rename(&tx, &source_path, target_id).map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };
    // ⑥ 删除源标签(外键级联兜底清理残余链接行)
    tx.execute("DELETE FROM tags WHERE id = ?1", params![source_id])
        .map_err(|e| e.to_string())?;
    // ⑦ 统一收尾:标签页条件级联(D7) -> 受影响笔记 FTS 重写 -> 孤儿回收(源的父链可能变空容器)。
    //    FTS 必须在删掉源标签之后显式重写:被转移链接的笔记不会自动刷新(tag_links 无 au 触发器),
    //    不重写会残留源路径且搜不到目标路径(2026-09-20 合并功能漏的正是这一步)。
    finish(
        &tx,
        PostWrite {
            notes: &notes,
            path_change: Some((source_path.as_str(), target_path.as_str())),
            gc: true,
        },
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(MergeReport {
        moved_links,
        affected_notes,
        aliases,
    })
}

/// 标签路径;不存在返回 None(供"标签不存在"中文报错)
fn path_of(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT path FROM tags WHERE id = ?1", params![id], |r| {
        r.get(0)
    })
    .optional()
}

/// 是否有子节点(D5:带子树的源标签不允许合并)
fn has_children(conn: &Connection, id: i64) -> rusqlite::Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tags WHERE parent_id = ?1",
        params![id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

#[cfg(test)]
#[path = "tree_merge_tests.rs"]
mod tree_merge_tests;

#[cfg(test)]
#[path = "tree_merge_extra_tests.rs"]
mod tree_merge_extra_tests;
