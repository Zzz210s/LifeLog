//! 标签携带标签数据层(spec 2026-10-05 §3 §4):复用 tag_links 的 `target_type='tag'` 行,
//! **零迁移、不动 tags 表结构**。
//!
//! 方向与既有约定一致 —— `tag_id` 是"谁"(携带者),`target_id` 是"对象"(被携带的标签):
//! `作者/丸尾常喜` 携带 `地点/国籍/日本` 写作 `(作者/丸尾常喜, 'tag', 地点/国籍/日本)`。
//! 主键 `(tag_id, target_type, target_id)` 天然去重,重复添加幂等。
//!
//! 语义口径(抄自 spec,勿在此处自由发挥):
//! - 只查一跳,不传递:A 携带 B、B 携带 C ≠ A 携带 C(S2)
//! - 拒绝自携带与环:A→A、A→B→A、A→B→C→A 一律拒绝(S3)
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;

/// 携带 / 被携带方向上的一个标签(id + 完整路径,供菜单与关系图信息条直读)
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct TagRef {
    pub id: i64,
    pub path: String,
}

/// 双向携带读数(IPC `list_tag_carries`):
/// `carried` = 本标签携带的;`carriersOf` = 携带本标签的。
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CarryReport {
    pub carried: Vec<TagRef>,
    pub carriers_of: Vec<TagRef>,
}

/// 携带链深度上限:正常标签体系远达不到,只在数据异常时兜底,避免环上死循环
const MAX_CARRY_DEPTH: usize = 64;

/// 添加携带(幂等):校验两端存在 -> 拒绝自携带 -> 沿携带方向 DFS 查环 -> INSERT OR IGNORE。
/// 整事务:校验失败或写入失败都零变化。携带行**不**参与 FTS/路径/孤儿收尾(它们只描述
/// 标签之间的关系,不改变任何笔记的标签集合),故这里有意不调 `tags_write::finish`。
pub fn set_carry(conn: &mut Connection, carrier_id: i64, carried_id: i64) -> Result<(), String> {
    if carrier_id == carried_id {
        return Err("不能携带自己".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let carrier = path_of(&tx, carrier_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("标签不存在: {carrier_id}"))?;
    let carried = path_of(&tx, carried_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("标签不存在: {carried_id}"))?;
    // 新边 carrier -> carried 成环 <=> 已存在 carried -> ... -> carrier 的路径
    if reaches(&tx, carried_id, carrier_id).map_err(|e| e.to_string())? {
        return Err(format!("会形成循环：携带「{carried}」会让「{carrier}」绕回自己"));
    }
    tx.execute(
        "INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'tag', ?2)",
        params![carrier_id, carried_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// 移除携带(幂等):不存在也算成功。单条 DELETE 本身原子,无需显式事务。
pub fn remove_carry(conn: &mut Connection, carrier_id: i64, carried_id: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM tag_links WHERE tag_id = ?1 AND target_type = 'tag' AND target_id = ?2",
        params![carrier_id, carried_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 双向读数:carried = 本标签携带的;carriersOf = 携带本标签的。两侧都按路径升序。
pub fn list_carries(conn: &Connection, carrier_id: i64) -> rusqlite::Result<CarryReport> {
    Ok(CarryReport {
        carried: refs(
            conn,
            "SELECT t.id, t.path FROM tag_links l JOIN tags t ON t.id = l.target_id \
             WHERE l.tag_id = ?1 AND l.target_type = 'tag' ORDER BY t.path",
            carrier_id,
        )?,
        carriers_of: refs(
            conn,
            "SELECT t.id, t.path FROM tag_links l JOIN tags t ON t.id = l.tag_id \
             WHERE l.target_id = ?1 AND l.target_type = 'tag' ORDER BY t.path",
            carrier_id,
        )?,
    })
}

/// 携带本标签的标签数(删除确认文案「该标签被 N 个标签携带」的读数;只数直接携带者,不含传递)
pub fn count_carriers(conn: &Connection, carried_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM tag_links WHERE target_type = 'tag' AND target_id = ?1",
        params![carried_id],
        |r| r.get(0),
    )
}

/// 标签路径;不存在返回 None(供"标签不存在"中文报错)
fn path_of(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT path FROM tags WHERE id = ?1", params![id], |r| r.get(0))
        .optional()
}

/// 按 SQL 取一列 TagRef(两条方向查询同形)
fn refs(conn: &Connection, sql: &str, id: i64) -> rusqlite::Result<Vec<TagRef>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![id], |r| {
        Ok(TagRef { id: r.get(0)?, path: r.get(1)? })
    })?;
    rows.collect()
}

/// 沿「携带」方向(carrier -> carried)从 `from` 出发能否到达 `to`。
/// 迭代 DFS + 已访集合:数据异常成环时也不会死循环;访问节点数超过上限即报错兜底。
fn reaches(conn: &Connection, from: i64, to: i64) -> rusqlite::Result<bool> {
    let mut seen: HashSet<i64> = HashSet::new();
    let mut stack = vec![from];
    while let Some(cur) = stack.pop() {
        if cur == to {
            return Ok(true);
        }
        if !seen.insert(cur) {
            continue;
        }
        if seen.len() > MAX_CARRY_DEPTH {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "携带链超过 {MAX_CARRY_DEPTH} 层,拒绝写入"
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
#[path = "carry_tests.rs"]
mod carry_tests;
