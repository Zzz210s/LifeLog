//! S1 收敛用到的 SQL 常量与读数 / 小查询助手(自 s1_tree.rs 拆出以守 200 行上限)。
//! 契约常量只此一份:时间根 / 待删中间层 / 闭包 / 笔记判据 / 信息流默认筛选 / 时间簇读数。
use super::Failure;
use crate::db::repos::filter_rewrite::rewrite_path;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

/// 收敛前后的关键读数(E2/E4/E5 的比对基准);现场重算,不硬编码
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Readings {
    pub points: i64,
    pub lines: i64,
    pub fts: i64,
    pub tree: i64,
    pub closure: i64,
    pub merge_log: i64,
    /// 信息流默认筛选命中数(E4;S1 前后必须不变)
    pub feed: i64,
    /// 「时间」簇节点与树边(E5;各减被删容器数)
    pub time_nodes: i64,
    pub time_edges: i64,
}

/// 时间根与待删中间层(契约冻结,spec §4.1;生产代码里没有这两个常量的其它副本)
pub(crate) const TIME_ROOT_PATH: &str = "时间";
pub(crate) const DATE_LAYER_PATH: &str = "时间/日期";

/// 闭包与树内点同口径(`is_cited` 种子 + 子级线递归),spec §10.3
pub(crate) const CLOSURE_SQL: &str = "WITH RECURSIVE c(id) AS (
    SELECT id FROM points WHERE is_cited = 1
    UNION SELECT l.from_id FROM lines l JOIN c ON c.id = l.to_id WHERE l.name_id = 0)
  SELECT COUNT(*) FROM c";

/// 内容点(笔记)判据:非保留点、非纯名字点;与对账块 ⑦ 的笔记口径一致
pub(crate) const NOTE_PREDICATE: &str = "p.path IS NULL AND p.id <> 0
  AND NOT EXISTS (SELECT 1 FROM lines n WHERE n.name_id = p.id)";

/// 信息流默认筛选(E4;spec §10.4,逐字对齐 `filter_predicates.rs` 的基线口径)
pub(crate) const FEED_DEFAULT_SQL: &str = "WITH RECURSIVE c(id) AS (
    SELECT id FROM points WHERE is_cited = 1
    UNION SELECT l.from_id FROM lines l JOIN c ON c.id = l.to_id WHERE l.name_id = 0)
  SELECT COUNT(*) FROM points p
  WHERE p.id <> 0
    AND NOT (EXISTS(SELECT 1 FROM lines nl WHERE nl.name_id = p.id)
             AND NOT EXISTS(SELECT 1 FROM lines tl WHERE tl.from_id = p.id OR tl.to_id = p.id))
    AND NOT (p.id IN (SELECT id FROM c) AND instr(p.meta, char(10)) = 0)";

/// 「时间」簇节点(E5):时间根与全部后代
pub(crate) const TIME_NODES_SQL: &str =
    "SELECT COUNT(*) FROM points WHERE path = '时间' OR path LIKE '时间/%'";

/// 「时间」簇的树边(E5):子级线里指向簇内节点的
pub(crate) const TIME_EDGES_SQL: &str = "SELECT COUNT(*) FROM lines WHERE name_id = 0 AND to_id IN
  (SELECT id FROM points WHERE path = '时间' OR path LIKE '时间/%')";

/// 路径 -> id(`path` 唯一索引保证只有一行)
pub(crate) fn path_id(conn: &Connection, path: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM points WHERE path = ?1 AND path IS NOT NULL",
        [path],
        |r| r.get(0),
    )
    .optional()
}

/// 某个容器的直接子级(id, path),按 path 升序
pub(crate) fn children_of(conn: &Connection, parent: i64) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, path FROM points WHERE parent_id = ?1 AND path IS NOT NULL ORDER BY path",
    )?;
    let rows = stmt.query_map(params![parent], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

pub(crate) fn leaf_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// 同父同键的兄弟(与 `move_to_ordered_core` 内部同一判据,`entity_key` 折叠空白与大小写)
pub(crate) fn sibling_by_key(
    conn: &Connection,
    parent: i64,
    name: &str,
    exclude: i64,
) -> Result<Option<i64>, String> {
    crate::db::repos::tags::merge::sibling_by_name(conn, Some(parent), name, exclude)
}

pub(crate) fn usage(e: impl ToString) -> Failure {
    Failure::usage(e.to_string())
}

pub(crate) fn check(e: impl ToString) -> Failure {
    Failure::check(e.to_string())
}

/// 逐项重算关键读数(E2/E4/E5 用)
pub fn readings(conn: &Connection) -> rusqlite::Result<Readings> {
    let one = |sql: &str| -> rusqlite::Result<i64> { conn.query_row(sql, [], |r| r.get(0)) };
    Ok(Readings {
        points: one("SELECT COUNT(*) FROM points")?,
        lines: one("SELECT COUNT(*) FROM lines")?,
        fts: one("SELECT COUNT(*) FROM points_fts")?,
        tree: one("SELECT COUNT(*) FROM points WHERE path IS NOT NULL")?,
        closure: one(CLOSURE_SQL)?,
        merge_log: one("SELECT COUNT(*) FROM entity_merge_log")?,
        feed: one(FEED_DEFAULT_SQL)?,
        time_nodes: one(TIME_NODES_SQL)?,
        time_edges: one(TIME_EDGES_SQL)?,
    })
}

/// `settings.graph_positions` 里键已不在 `points` 的条目数(P7:**只报读数,不清理**)。
/// 键不是节点 id 的一并计入(它们匹配不上任何节点);键缺失 / 坏 JSON 都算 0。
pub(crate) fn stale_position_keys(conn: &Connection) -> rusqlite::Result<i64> {
    let Some(raw) = crate::db::repos::settings::get(conn, "graph_positions")? else {
        return Ok(0);
    };
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&raw) else {
        return Ok(0);
    };
    let mut stale = 0i64;
    for key in map.keys() {
        let alive = match key.parse::<i64>() {
            Ok(id) => conn.query_row("SELECT COUNT(*) FROM points WHERE id = ?1", [id], |r| {
                r.get::<_, i64>(0)
            })?,
            Err(_) => 0,
        };
        if alive == 0 {
            stale += 1;
        }
    }
    Ok(stale)
}

/// 标签路径串 -> **集合**:去重 + 升序。合并语义是链接取并集(同一目标只留一条线),
/// 且 `时间/日期/X` 改成 `时间/X` 后可能与其它标签**换位**(真库 91 篇:
/// `时间/出版年份/2016` 原排在 `时间/日期/2026/03/28` 前,映射后 `时间/2026/...` 在前),
/// 故 E1 只能按集合比,不能按顺序串比(spec §10.1 写的「逐字节相同」只对集合成立)。
pub(crate) fn map_set(joined: &str, old: &str, new: &str) -> Vec<String> {
    let mut v: Vec<String> = split_raw(joined)
        .map(|p| rewrite_path(&p, old, new).unwrap_or(p))
        .collect();
    v.sort();
    v.dedup();
    v
}

/// 同上但不做前缀映射(收敛后的读数)
pub(crate) fn split_set(joined: &str) -> Vec<String> {
    let mut v: Vec<String> = split_raw(joined).collect();
    v.sort();
    v.dedup();
    v
}

pub(crate) fn split_raw(joined: &str) -> impl Iterator<Item = String> + '_ {
    joined
        .split('\n')
        .filter(|p| !p.is_empty())
        .map(str::to_string)
}

/// 笔记 id -> 升序标签路径串(含无标签笔记,空串);标签只取非子级线的目标点
pub(crate) fn note_tags(conn: &Connection) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT p.id, COALESCE((SELECT group_concat(x.path, char(10)) FROM (
             SELECT t.path AS path FROM lines e JOIN points t ON t.id = e.to_id
              WHERE e.from_id = p.id AND (e.name_id IS NULL OR e.name_id <> 0)
                AND t.path IS NOT NULL ORDER BY t.path) AS x), '')
           FROM points p WHERE {NOTE_PREDICATE} ORDER BY p.id"
    ))?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}
