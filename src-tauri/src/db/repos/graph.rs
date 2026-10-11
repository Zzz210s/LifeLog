//! 关系图数据仓库层(G1 Task 1):节点、父子边、共现边、笔记间链接边(L4)。**只读**,不写库不加表。
//!
//! v31 点/线(spec §5.2):节点 = §3.3 渲染闭包(`is_cited=1` ∪ 沿入子级线上溯的全部祖先),
//! 父子边 = 子级线(`lines WHERE name_id = 0`),共现边 = 非子级线自连接;纯名字点 `path IS NULL`、
//! `is_cited = 0`,天然不进闭包种子。链接边由 `note_links::all_resolved` 供给(`GraphLink` 的
//! `a`/`b` 是实体 id,与闭包节点 id 同空间)。节点计数口径与 `tags::query::counts` 同源;
//! 共现边按枢纽阈值排除大标签(阈值 60 下 v31 现场 735 条,见 `graph_calibration_tests`)。
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

/// 渲染闭包节点 + 含子级/本级**去重**引用源数 + 次序键,按 path 升序(一次采完)。
/// 节点集合 = §3.3 渲染闭包(`is_cited=1` ∪ 沿入子级线上溯的祖先),与侧栏树同源;种子额外要求
/// `path IS NOT NULL`(否则被 `[[ ]]` 引用的笔记会让 `t.path` 读到 NULL)。`roll` 只算含子级、
/// `selfc` 只算本级(别用一个 COUNT 兼两义,否则无链接节点会被 LEFT JOIN 吞掉)。
///
/// SQL 抽成常量供 `note_links_perf_tests::graph_nodes_plan_uses_idx_lines_to` 跑 `EXPLAIN`。
/// `l INDEXED BY idx_lines_to` 是 T4.4 修复:规划器曾改选 `idx_lines_name` + `SCAN up`,
/// 把 9.4ms 的闭包查询拖到 41.8ms;显式按 `to_id` 上溯后回到 9.6ms。
pub(crate) const NODES_SQL: &str = "WITH RECURSIVE up(id) AS (
           SELECT id FROM points WHERE is_cited = 1 AND path IS NOT NULL
           UNION
           SELECT l.from_id FROM lines l INDEXED BY idx_lines_to
             JOIN up ON l.to_id = up.id WHERE l.name_id = 0
         ),
         sub(root, leaf) AS (
           SELECT id, id FROM up
           UNION ALL SELECT s.root, p.id FROM points p JOIN sub s ON p.parent_id = s.leaf
         ),
         roll AS (SELECT sub.root AS root, COUNT(DISTINCT l.from_id) AS n
                  FROM sub JOIN lines l
                    ON l.to_id = sub.leaf AND (l.name_id IS NULL OR l.name_id <> 0)
                  GROUP BY sub.root),
         selfc AS (SELECT to_id AS id, COUNT(DISTINCT from_id) AS n
                   FROM lines WHERE name_id IS NULL OR name_id <> 0 GROUP BY to_id)
         SELECT t.id, t.path, t.depth, t.parent_id, COALESCE(roll.n, 0), COALESCE(selfc.n, 0), t.sort_order
         FROM up JOIN points t ON t.id = up.id
         LEFT JOIN roll ON roll.root = t.id LEFT JOIN selfc ON selfc.id = t.id
         ORDER BY t.path";

pub fn nodes(conn: &Connection) -> SqlResult<Vec<GraphNode>> {
    let mut stmt = conn.prepare(NODES_SQL)?;
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

/// 父子边:每条非根实体一条,方向恒为 父 -> 子(子边必在闭包内,由入子级线决定;
/// 子级线 = `name_id = 0` 的保留点 `子级`)
pub fn tree_edges(conn: &Connection) -> SqlResult<Vec<GraphEdge>> {
    let mut stmt = conn.prepare(
        "SELECT from_id, to_id FROM lines WHERE name_id = 0 ORDER BY to_id",
    )?;
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

/// 某实体(含子孙)的「出链 N / 入链 M」:一条 SQL 取两个计数。
/// `COUNT(DISTINCT nl.id)`:一条实体同时挂祖先与子孙时非子级线重复出现,
/// 不去重就会把同一条链接按实体数算好几遍(与 `nodes` 的去重口径同源)。
/// v31 起链接侧读非子级线(`name_id IS NULL OR name_id <> 0`);两侧都按 `path IS NULL` 收窄:
/// `tl` 只认树外来源(笔记挂标签),`nl` 只认笔记间的 `[[ ]]` 链接。实体不存在时两数都是 0。
pub fn link_degrees(conn: &Connection, tag_id: i64) -> SqlResult<LinkDegrees> {
    conn.query_row(
        "WITH RECURSIVE sub(leaf) AS (
           SELECT id FROM points WHERE path IS NOT NULL AND id = ?1
           UNION ALL SELECT p.id FROM points p JOIN sub s ON p.parent_id = s.leaf
         )
         SELECT
           (SELECT COUNT(DISTINCT nl.id) FROM sub
              JOIN lines tl ON (tl.name_id IS NULL OR tl.name_id <> 0) AND tl.to_id = sub.leaf
                AND tl.from_id IN (SELECT id FROM points WHERE path IS NULL)
              JOIN lines nl ON (nl.name_id IS NULL OR nl.name_id <> 0)
                AND nl.from_id = tl.from_id
                AND nl.to_id IN (SELECT id FROM points WHERE path IS NULL)
              WHERE nl.from_id <> nl.to_id),
           (SELECT COUNT(DISTINCT nl.id) FROM sub
              JOIN lines tl ON (tl.name_id IS NULL OR tl.name_id <> 0) AND tl.to_id = sub.leaf
                AND tl.from_id IN (SELECT id FROM points WHERE path IS NULL)
              JOIN lines nl ON (nl.name_id IS NULL OR nl.name_id <> 0)
                AND nl.to_id = tl.from_id
                AND nl.from_id IN (SELECT id FROM points WHERE path IS NULL)
              WHERE nl.from_id <> nl.to_id)",
        [tag_id],
        |r| {
            Ok(LinkDegrees {
                outbound: r.get(0)?,
                backlinks: r.get(1)?,
            })
        },
    )
}

/// 共现边:`a.to_id < b.to_id` 保证每条无向边只出现一次;枢纽实体两端都不参与。
pub fn co_edges(conn: &Connection, hub_threshold: i64) -> SqlResult<Vec<GraphEdge>> {
    let mut stmt = conn.prepare(
        "WITH non_tree AS (SELECT from_id, to_id, id FROM lines
                            WHERE name_id IS NULL OR name_id <> 0),
         hub AS (
           SELECT to_id FROM non_tree
           GROUP BY to_id HAVING COUNT(DISTINCT from_id) > ?1
         )
         SELECT a.to_id, b.to_id, COUNT(*) AS w
         FROM non_tree a JOIN non_tree b
           ON a.from_id = b.from_id AND a.to_id < b.to_id
         WHERE a.to_id NOT IN (SELECT to_id FROM hub)
           AND b.to_id NOT IN (SELECT to_id FROM hub)
         GROUP BY a.to_id, b.to_id
         ORDER BY a.to_id, b.to_id",
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

#[cfg(test)] #[path = "graph_tests.rs"] mod graph_tests;
#[cfg(test)] #[path = "graph_links_tests.rs"] mod graph_links_tests;
// T4.2 阈值标定读数(真库只读,默认 ignored)
#[cfg(test)] #[path = "graph_calibration_tests.rs"] mod graph_calibration_tests;
// T4.4 点/线热路径读数与查询计划守卫(真库/副本只读,默认部分 ignored)
#[cfg(test)] #[path = "perf_point_line_tests.rs"] mod perf_point_line_tests;
