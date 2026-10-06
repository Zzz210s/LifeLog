//! 标签关系(relation)数据层(设计 2026-10-06 §2 §4):一条边取代「携带 / 类型 / 设为类型」三个概念。
//!
//! `tag_links(tag_id = A, target_type = 'tag', target_id = B)` 读作「A 具有 B 所表示的属性」，
//! 方向固定 A -> B；任何标签都可被指向（`tags.is_type` 已由迁移 022 取消）。
//! 主键 `(tag_id, target_type, target_id)` 天然去重，重复添加幂等。
//! `target_id` 上没有外键：删除标签必须显式清理指向它的边（见 ops::delete_subtree / merge_tags）。
//!
//! 语义口径（设计 §4，勿在此处自由发挥）:
//! - 只查一跳，不传递：A→B、B→C ≠ A→C（R1）
//! - 拒绝自指向与环：A→A、A→B→A、A→B→C→A 一律拒绝（R3）
//! - 箭头上的文字备注 = 被指向标签 B 自己**名字里的 md 备注**（`[国籍](国别)` 的 `国别`），
//!   只影响显示，不参与筛选 / FTS / 计数（R6）
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;

use crate::tag_label_plain::{parse_label, LabelToken};

/// 关系边一端(供菜单、侧栏与关系图信息条直读):目标标签 id + 完整路径 + 末段名 + 名字备注
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelationRef {
    pub to_tag_id: i64,
    pub path: String,
    pub name: String,
    /// B 名字里的 md 备注(`[国籍](国别)` -> `国别`);没有备注时为空串
    pub remark: String,
}

/// 关系链深度上限:正常标签体系远达不到，只在数据异常时兜底，避免环上死循环
const MAX_RELATION_DEPTH: usize = 64;

/// 建立关系 A → B(幂等)：校验两端存在 -> 拒绝自指向 -> 沿关系方向 DFS 查环 -> INSERT OR IGNORE。
/// 整事务:校验失败或写入失败都零变化。关系行**不**参与 FTS / 路径 / 笔记标签集合，
/// 故这里有意不调 `tags_write::finish`（与迁移前的携带写入同一口径）。
pub fn set_tag_relation(
    conn: &mut Connection,
    from_tag_id: i64,
    to_tag_id: i64,
) -> Result<(), String> {
    if from_tag_id == to_tag_id {
        return Err("不能建立指向自己的关系".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let from = path_of(&tx, from_tag_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("标签不存在: {from_tag_id}"))?;
    let to = path_of(&tx, to_tag_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("标签不存在: {to_tag_id}"))?;
    // 新边 A -> B 成环 <=> 已存在 B -> ... -> A 的路径
    if reaches(&tx, to_tag_id, from_tag_id).map_err(|e| e.to_string())? {
        return Err(format!("会形成循环：建立「{from}」到「{to}」的关系会让「{from}」绕回自己"));
    }
    tx.execute(
        "INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'tag', ?2)",
        params![from_tag_id, to_tag_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// 移除关系 A → B(幂等：不存在也算成功)。单条 DELETE 本身原子，无需显式事务。
pub fn remove_tag_relation(
    conn: &mut Connection,
    from_tag_id: i64,
    to_tag_id: i64,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM tag_links WHERE tag_id = ?1 AND target_type = 'tag' AND target_id = ?2",
        params![from_tag_id, to_tag_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 本标签的全部出边(A → ?)，按目标路径升序
pub fn list_tag_relations(conn: &Connection, from_tag_id: i64) -> rusqlite::Result<Vec<RelationRef>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.path FROM tag_links l JOIN tags t ON t.id = l.target_id \
         WHERE l.tag_id = ?1 AND l.target_type = 'tag' ORDER BY t.path",
    )?;
    let rows = stmt.query_map(params![from_tag_id], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
    })?;
    rows.map(|row| row.map(|(id, path)| relation_ref(id, &path))).collect()
}

/// 指向本标签的边数(删除确认文案「该标签被 N 个标签指向」的读数):
/// 只数 `target_id` 就是本标签的直接入边 —— 不含传递，也**不含指向子孙标签的边**。
pub fn count_relations_to(conn: &Connection, to_tag_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM tag_links WHERE target_type = 'tag' AND target_id = ?1",
        params![to_tag_id],
        |r| r.get(0),
    )
}

/// 由 (id, path) 组装一条关系读数：name = 路径末段，remark = 末段名里的 md 备注
pub(super) fn relation_ref(to_tag_id: i64, path: &str) -> RelationRef {
    let name = leaf(path);
    let remark = remark_of(&name);
    RelationRef { to_tag_id, path: path.to_string(), name, remark }
}

/// 标签路径;不存在返回 None(供"标签不存在"中文报错)
fn path_of(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT path FROM tags WHERE id = ?1", params![id], |r| r.get(0))
        .optional()
}

/// 路径末段(标签名);`/` 是路径分隔符，单段路径即整串
pub(super) fn leaf(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

/// 名字里的 md 备注:取名字中第一个非空链接备注(`[国籍](国别)` -> `国别`)。
/// 与前端 `renderTagLabel` 的 `data-tip` 同一来源(标签名行内 md)，仅用于显示(R6)。
fn remark_of(name: &str) -> String {
    parse_label(name)
        .into_iter()
        .find_map(|t| match t {
            LabelToken::Link { title, .. } if !title.is_empty() => Some(title),
            _ => None,
        })
        .unwrap_or_default()
}

/// 沿「关系」方向(A -> B)从 `from` 出发能否到达 `to`。
/// 迭代 DFS + 已访集合:数据异常成环时也不会死循环;访问节点数超过上限即报错兜底。
/// 同模块的合并路径(merge)复用它判「迁移后是否成环」，故对 tags 子树可见。
pub(super) fn reaches(conn: &Connection, from: i64, to: i64) -> rusqlite::Result<bool> {
    let mut seen: HashSet<i64> = HashSet::new();
    let mut stack = vec![from];
    while let Some(cur) = stack.pop() {
        if cur == to {
            return Ok(true);
        }
        if !seen.insert(cur) {
            continue;
        }
        if seen.len() > MAX_RELATION_DEPTH {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "关系链超过 {MAX_RELATION_DEPTH} 层,拒绝写入"
            )));
        }
        let mut stmt = conn.prepare(
            "SELECT target_id FROM tag_links WHERE tag_id = ?1 AND target_type = 'tag'",
        )?;
        let rows = stmt.query_map(params![cur], |r| r.get::<_, i64>(0))?;
        for row in rows {
            stack.push(row?);
        }
    }
    Ok(false)
}

#[cfg(test)]
#[path = "relation_tests.rs"]
mod relation_tests;

#[cfg(test)]
#[path = "relation_read_tests.rs"]
mod relation_read_tests;
