//! S1 收敛用到的 SQL 常量与小查询助手(自 s1_tree.rs 拆出以守 200 行上限)。
//! 契约常量只此一份:时间根 / 待删中间层 / 闭包 / 笔记判据 / 信息流默认筛选 / 时间簇读数。
use super::Failure;
use rusqlite::{params, Connection, OptionalExtension};

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
