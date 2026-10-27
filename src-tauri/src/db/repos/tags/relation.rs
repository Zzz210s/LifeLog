//! 标签关系(relation)数据层(设计 2026-10-06 §2 §4):一条边取代「携带 / 类型 / 设为类型」三个概念。
//!
//! `lines(from_id = A, to_id = B, name_id = 名字点)` 读作
//! 「A 具有「名字」所表示的属性，值是 B」，如 `作者/丸尾常喜 --(国籍)--> 地点轴/日本`；
//! 方向固定 A -> B；任何标签都可被指向（`tags.is_type` 已由迁移 022 取消）。
//! 028 起关系的判别不再是 `kind` 而是**来源是树内点**:树内来源(`path IS NOT NULL`)、
//! 且不是子级线(`name_id` 非保留点 `子级`)的线即关系,树外来源(笔记正文里的 `[[ ]]`)不算。
//! 唯一索引 `idx_lines_uniq(from_id, to_id, COALESCE(name_id, -1))` 天然去重，重复添加幂等。
//! 两端有外键：删除标签时指向它的线由 `ON DELETE CASCADE` 清理。
//!
//! 语义口径（设计 §4，勿在此处自由发挥）:
//! - 只查一跳，不传递：A→B、B→C ≠ A→C（R1）
//! - 拒绝自指向与环：A→A、A→B→A、A→B→C→A 一律拒绝（R3）
//! - 名字是**名字点**(`points.meta`，spec §6.4)：读作「A 具有「名字」所表示的属性，值是 B」。
//!   同一个 `地点轴/日本` 可以既是「国籍」又是「出生地」(同对可并存多条同名线之外的名字线，P9)；
//!   名字点匹配**逐字节** `meta`，不走 `entity_key` 折叠（P10）。名字只影响显示，
//!   不参与筛选 / FTS / 计数（R6）
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;

#[path = "relation_read.rs"]
mod relation_read;
pub use relation_read::*;

/// 关系链深度上限:正常标签体系远达不到，只在数据异常时兜底，避免环上死循环
const MAX_RELATION_DEPTH: usize = 64;

/// 建立关系 A → B(幂等)：校验两端存在 -> 拒绝自指向 -> 沿关系方向 DFS 查环 -> 写线。
/// 整事务:校验失败或写入失败都零变化。线**不**参与 FTS / 路径 / 笔记标签集合，
/// 故这里有意不调 `tags_write::finish`(与迁移前的携带写入同一口径);线的增删改由
/// 031 的触发器维护 `points_fts` 与 `is_cited`。
///
/// `remark` 是**关系名文本**(P6):空串 = 清除名字(该线回无名字线);非空 = 逐字节匹配纯名字点,
/// 没有就建点,再把既有线的 `name_id` 指过去 —— v30 口径保留:同一对 `(from, to)` 的既有线
/// 只换名字,不新开线(spec §3.2「同一条线换名字 = 换 name_id」)。该对还没有线时,插入由
/// `idx_lines_uniq(from_id, to_id, COALESCE(name_id, -1))` 的表达式 conflict target 兜底。
pub fn set_tag_relation(
    conn: &mut Connection,
    from_tag_id: i64,
    to_tag_id: i64,
    remark: &str,
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
    // 新线 A -> B 成环 <=> 已存在 B -> ... -> A 的路径
    if reaches(&tx, to_tag_id, from_tag_id).map_err(|e| e.to_string())? {
        return Err(format!("会形成循环：建立「{from}」到「{to}」的关系会让「{from}」绕回自己"));
    }
    let name_id: Option<i64> = if remark.is_empty() {
        None
    } else {
        Some(super::line_name::resolve_or_create_name_point(&tx, remark).map_err(|e| e.to_string())?)
    };
    // 这个 (from,to,name) 的线已在 -> 幂等返回;否则把该对既有线的名字换掉,没有线才插。
    let existing: bool = match name_id {
        Some(nid) => tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM lines WHERE from_id = ?1 AND to_id = ?2 AND name_id = ?3)",
                params![from_tag_id, to_tag_id, nid],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?,
        None => tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tag_lines WHERE from_id = ?1 AND to_id = ?2)",
                params![from_tag_id, to_tag_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?,
    };
    if !existing {
        // 换名时旧名字点可能失去最后一条引用:先记下,换完交给 GC 核对回收(T3.3)
        let old_name: Option<i64> = tx
            .query_row(
                "SELECT name_id FROM lines WHERE from_id = ?1 AND to_id = ?2 ORDER BY id LIMIT 1",
                params![from_tag_id, to_tag_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        let updated = tx
            .execute(
                "UPDATE lines SET name_id = ?3
                  WHERE id = (SELECT id FROM lines WHERE from_id = ?1 AND to_id = ?2 ORDER BY id LIMIT 1)",
                params![from_tag_id, to_tag_id, name_id],
            )
            .map_err(|e| e.to_string())?;
        if updated == 0 {
            // 统一写入入口(不存在才插;存在则上面那条 UPDATE 已处理)
            crate::db::repos::lines_write::insert(&tx, from_tag_id, to_tag_id, name_id)
            .map_err(|e| e.to_string())?;
        }
        if let Some(old) = old_name {
            if Some(old) != name_id {
                super::tree::queue_name_point_gc(&tx, old).map_err(|e| e.to_string())?;
            }
        }
    }
    super::tree::reclaim_name_points(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// 移除关系 A → B(幂等：不存在也算成功)。`name_id` 给了就只删那条有名线,不给只删无名字线
/// (spec §8.1:一对多点可有多条线,删哪条必须能指定)。删完回收失去最后引用的名字点(T3.3)。
pub fn remove_tag_relation(
    conn: &mut Connection,
    from_tag_id: i64,
    to_tag_id: i64,
    name_id: Option<i64>,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    match name_id {
        Some(nid) => tx.execute(
            "DELETE FROM lines WHERE from_id = ?1 AND to_id = ?2 AND name_id = ?3",
            params![from_tag_id, to_tag_id, nid],
        ),
        None => tx.execute(
            "DELETE FROM lines WHERE id IN (SELECT id FROM tag_lines WHERE from_id = ?1 AND to_id = ?2)",
            params![from_tag_id, to_tag_id],
        ),
    }
    .map_err(|e| e.to_string())?;
    if let Some(nid) = name_id {
        super::tree::queue_name_point_gc(&tx, nid).map_err(|e| e.to_string())?;
    }
    super::tree::reclaim_name_points(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// 标签路径;不存在返回 None(供"标签不存在"中文报错)
fn path_of(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT path FROM points WHERE id = ?1 AND path IS NOT NULL",
        params![id],
        |r| r.get(0),
    )
    .optional()
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
            "SELECT to_id FROM non_tree_lines WHERE from_id = ?1",
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

#[cfg(test)]
#[path = "relation_name_tests.rs"]
mod relation_name_tests;
