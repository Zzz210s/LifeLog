//! 关系图数据仓库层(G1 Task 1):节点、父子边、共现边。**只读**,不写库不加表。
//!
//! 口径与标签侧保持一致:
//! - 节点计数复用 `tags::tree::query::counts` 的「含子级去重笔记数」算法(一条笔记同时链了
//!   父与子时只算一次),否则侧栏计数与筛选结果会对不上。
//! - 共现边 = 同一条笔记上共同出现的标签对,权重 = 共同出现的笔记数(注意是笔记数,不是
//!   链接对数)。出现笔记数超过阈值的枢纽标签(如"时间"这类)一律不参与 —— 实测去掉后
//!   边数从 2628 降到 771,图才不至于糊成毛球。
use rusqlite::{Connection, Result as SqlResult};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EdgeKind {
    Tree,
    Co,
}

#[derive(Clone, Debug)]
pub struct GraphNode {
    pub id: i64,
    pub path: String,
    pub depth: i64,
    pub parent: Option<i64>,
    /// 含子级**去重**笔记数(一条笔记同时链父子只算一次)
    pub notes: i64,
    /// 本级去重笔记数(不含子级;字段名避开 Rust 关键字)
    pub self_count: i64,
    /// 同层次序键,与 tags.sort_order 同口径(右键菜单要按它排)
    pub sort_order: i64,
}

#[derive(Clone, Debug)]
pub struct GraphEdge {
    pub a: i64,
    pub b: i64,
    pub kind: EdgeKind,
    pub weight: i64,
}

/// 全部标签 + 含子级**去重**笔记数 + 本级去重笔记数 + 次序键,按 path 升序(一次采完)。
/// `roll` 只算含子级(与 tags::query::counts 同口径),`selfc` 只算本级 —— 两个聚合分开,
/// 别用一个 COUNT 兼两义(层级过滤写进 SELECT 会让 LEFT JOIN 退化成内连接,没有链接的标签消失)。
pub fn nodes(conn: &Connection) -> SqlResult<Vec<GraphNode>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE sub(root, leaf) AS (
           SELECT id, id FROM tags
           UNION ALL SELECT s.root, t.id FROM tags t JOIN sub s ON t.parent_id = s.leaf
         ),
         roll AS (SELECT sub.root AS root, COUNT(DISTINCT l.target_id) AS n
                  FROM sub JOIN tag_links l ON l.tag_id = sub.leaf AND l.target_type = 'note'
                  GROUP BY sub.root),
         selfc AS (SELECT tag_id AS id, COUNT(DISTINCT target_id) AS n
                   FROM tag_links WHERE target_type = 'note' GROUP BY tag_id)
         SELECT t.id, t.path, t.depth, t.parent_id, COALESCE(roll.n, 0), COALESCE(selfc.n, 0), t.sort_order
         FROM tags t LEFT JOIN roll ON roll.root = t.id LEFT JOIN selfc ON selfc.id = t.id
         ORDER BY t.path",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(GraphNode {
            id: r.get(0)?,
            path: r.get(1)?,
            depth: r.get(2)?,
            parent: r.get(3)?,
            notes: r.get(4)?,
            self_count: r.get(5)?,
            sort_order: r.get(6)?,
        })
    })?;
    rows.collect()
}

/// 父子边:每条非根标签一条,方向恒为 父 -> 子
pub fn tree_edges(conn: &Connection) -> SqlResult<Vec<GraphEdge>> {
    let mut stmt =
        conn.prepare("SELECT parent_id, id FROM tags WHERE parent_id IS NOT NULL ORDER BY id")?;
    let rows = stmt.query_map([], |r| {
        Ok(GraphEdge {
            a: r.get(0)?,
            b: r.get(1)?,
            kind: EdgeKind::Tree,
            weight: 1,
        })
    })?;
    rows.collect()
}

/// 共现边:`a.tag_id < b.tag_id` 保证每条无向边只出现一次;枢纽标签两端都不参与。
pub fn co_edges(conn: &Connection, hub_threshold: i64) -> SqlResult<Vec<GraphEdge>> {
    let mut stmt = conn.prepare(
        "WITH hub AS (
           SELECT tag_id FROM tag_links WHERE target_type = 'note'
           GROUP BY tag_id HAVING COUNT(DISTINCT target_id) > ?1
         )
         SELECT a.tag_id, b.tag_id, COUNT(*) AS w
         FROM tag_links a JOIN tag_links b
           ON a.target_id = b.target_id AND a.tag_id < b.tag_id
         WHERE a.target_type = 'note' AND b.target_type = 'note'
           AND a.tag_id NOT IN (SELECT tag_id FROM hub)
           AND b.tag_id NOT IN (SELECT tag_id FROM hub)
         GROUP BY a.tag_id, b.tag_id
         ORDER BY a.tag_id, b.tag_id",
    )?;
    let rows = stmt.query_map([hub_threshold], |r| {
        Ok(GraphEdge {
            a: r.get(0)?,
            b: r.get(1)?,
            kind: EdgeKind::Co,
            weight: r.get(2)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
#[path = "graph_tests.rs"]
mod graph_tests;
