//! 关系图数据仓库层(G1 Task 1):节点、父子边、共现边、笔记间链接边(L4)。**只读**,不写库不加表。
//!
//! T4.3 起节点与树/共现边统一读 `entities`/`edges`:节点 = `entities(kind='tag')`(id 为标签实体 id),
//! 父子边 = `edges(kind='child')`,共现边 = `edges(kind='tagging')` 自连接。
//! 笔记间链接边仍由 `note_links::all_resolved` 供给(计划 T4.6 把它改读 `edges(kind='link')`,签名不动),
//! 故 `link_degrees` 的链接侧仍读 `note_links`,只有「哪些笔记挂着该标签」走 `edges(kind='tagging')`。
//! `GraphLink` 的 `a`/`b` 是**笔记实体 id**,与标签实体 id 是两套命名空间(前端按 `kind` 分流)。
//!
//! 口径与标签侧保持一致:
//! - 节点计数复用 `tags::tree::query::counts` 的「含子级去重笔记数」算法(一条笔记同时链了
//!   父与子时只算一次),否则侧栏计数与筛选结果会对不上。
//! - 共现边 = 同一条笔记上共同出现的标签对,权重 = 共同出现的笔记数(注意是笔记数,不是
//!   链接对数)。出现笔记数超过阈值的枢纽标签(如"时间"这类)一律不参与 —— 实测去掉后
//!   边数从 2628 降到 771,图才不至于糊成毛球。
use super::note_links;
use rusqlite::{Connection, Result as SqlResult};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EdgeKind {
    Tree,
    Co,
}

/// 一条笔记间的**已解析**链接(IPC `kind: "link"` 的那类边)。
/// 单独一个类型而不复用 `GraphEdge`:`GraphEdge.a/b` 是标签 id,两套 id 混进同一个列表
/// 会被下游当成同一张图(笔记 id 与标签 id 数值撞车很常见)。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GraphLink {
    pub a: i64,
    pub b: i64,
}

/// 某标签(含子孙)的出链 / 入链条数(L4 信息条读数)。
/// 口径:只算**已解析且非自指**的链接(与图上真能画出来的 link 边同一口径),含子孙
/// (与 `GraphNode.notes`、展开笔记的扇形同一批笔记),同一链接只算一次。
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub struct LinkDegrees {
    pub outbound: i64,
    pub backlinks: i64,
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
           SELECT id, id FROM entities WHERE kind = 'tag'
           UNION ALL SELECT s.root, e.id FROM entities e JOIN sub s ON e.parent_id = s.leaf
                      WHERE e.kind = 'tag'
         ),
         roll AS (SELECT sub.root AS root, COUNT(DISTINCT l.source_id) AS n
                  FROM sub JOIN edges l ON l.target_id = sub.leaf AND l.kind = 'tagging'
                  GROUP BY sub.root),
         selfc AS (SELECT target_id AS id, COUNT(DISTINCT source_id) AS n
                   FROM edges WHERE kind = 'tagging' GROUP BY target_id)
         SELECT t.id, t.path, t.depth, t.parent_id, COALESCE(roll.n, 0), COALESCE(selfc.n, 0), t.sort_order
         FROM entities t LEFT JOIN roll ON roll.root = t.id LEFT JOIN selfc ON selfc.id = t.id
         WHERE t.kind = 'tag'
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
    let mut stmt = conn
        .prepare("SELECT source_id, target_id FROM edges WHERE kind = 'child' ORDER BY target_id")?;
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

/// 笔记间链接边(L4):全部**已解析**的链接(`all_resolved` 已排掉自指与未解析),
/// 插入序。节点是标签实体、笔记节点只在展开时出现,所以画不画由前端按
/// 「两端笔记都在展开的扇形里」自己决定 —— 这里只管把两端 id 交出去。
pub fn link_edges(conn: &Connection) -> SqlResult<Vec<GraphLink>> {
    Ok(note_links::all_resolved(conn)?
        .into_iter()
        .map(|(a, b)| GraphLink { a, b })
        .collect())
}

/// 某标签(含子孙)的「出链 N / 入链 M」:一条 SQL 取两个计数,零额外 IPC 也能给信息条。
/// `COUNT(DISTINCT nl.id)`:一条笔记同时挂祖先与子孙标签时 `tagging` 边重复出现,
/// 不去重就会把同一条链接按标签数算好几遍(与 `nodes` 的去重口径同源)。
/// 标签实体不存在时两数都是 0(不报错)。
pub fn link_degrees(conn: &Connection, tag_id: i64) -> SqlResult<LinkDegrees> {
    conn.query_row(
        "WITH RECURSIVE sub(leaf) AS (
           SELECT id FROM entities WHERE kind = 'tag' AND id = ?1
           UNION ALL SELECT e.id FROM entities e JOIN sub s ON e.parent_id = s.leaf
                      WHERE e.kind = 'tag'
         )
         SELECT
           (SELECT COUNT(DISTINCT nl.id) FROM sub
              JOIN edges tl ON tl.kind = 'tagging' AND tl.target_id = sub.leaf
              JOIN note_links nl ON nl.source_id = tl.source_id
              WHERE nl.target_id IS NOT NULL AND nl.source_id <> nl.target_id),
           (SELECT COUNT(DISTINCT nl.id) FROM sub
              JOIN edges tl ON tl.kind = 'tagging' AND tl.target_id = sub.leaf
              JOIN note_links nl ON nl.target_id = tl.source_id
              WHERE nl.source_id <> nl.target_id)",
        [tag_id],
        |r| {
            Ok(LinkDegrees {
                outbound: r.get(0)?,
                backlinks: r.get(1)?,
            })
        },
    )
}

/// 共现边:`a.target_id < b.target_id` 保证每条无向边只出现一次;枢纽标签两端都不参与。
pub fn co_edges(conn: &Connection, hub_threshold: i64) -> SqlResult<Vec<GraphEdge>> {
    let mut stmt = conn.prepare(
        "WITH hub AS (
           SELECT target_id FROM edges WHERE kind = 'tagging'
           GROUP BY target_id HAVING COUNT(DISTINCT source_id) > ?1
         )
         SELECT a.target_id, b.target_id, COUNT(*) AS w
         FROM edges a JOIN edges b
           ON a.source_id = b.source_id AND a.target_id < b.target_id
         WHERE a.kind = 'tagging' AND b.kind = 'tagging'
           AND a.target_id NOT IN (SELECT target_id FROM hub)
           AND b.target_id NOT IN (SELECT target_id FROM hub)
         GROUP BY a.target_id, b.target_id
         ORDER BY a.target_id, b.target_id",
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

#[cfg(test)]
#[path = "graph_links_tests.rs"]
mod graph_links_tests;
