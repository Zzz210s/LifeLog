//! T1.4 祖先闭包与 `is_cited` 增量维护(spec §3.1 / §3.3)。
//! 夹具 = 全新库(`migrate::run` 到最新 v29),直接读写 `entities` / `edges`。
use super::closure::{in_tree_predicate, sync_is_cited, tree_closure_ids};
use crate::db::migrate;
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 建实体:`path` 给出即树内节点,`None` = 树外(笔记形态);`cited` 直写 `is_cited`。
fn ent(c: &Connection, id: i64, meta: &str, cited: i64, path: Option<&str>) {
    let depth = path.map(|p| p.matches('/').count() as i64 + 1);
    c.execute(
        "INSERT INTO entities(id, meta, is_cited, created_at, parent_id, path, depth)
         VALUES(?1, ?2, ?3, '2026-01-01T00:00:00.000', NULL, ?4, ?5)",
        params![id, meta, cited, path, depth],
    )
    .unwrap();
}

fn edge(c: &Connection, source: i64, target: i64, kind: &str) {
    c.execute(
        "INSERT INTO edges(source_id, target_id, kind, remark, created_at)
         VALUES(?1, ?2, ?3, '', '2026-01-01T00:00:00.000')",
        params![source, target, kind],
    )
    .unwrap();
}

fn cited(c: &Connection, id: i64) -> i64 {
    c.query_row("SELECT is_cited FROM entities WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

/// `1 -> 2 -> 3`(3 被笔记 6 引用);`4 -> 5` 整条无被引用后代,不进闭包。
/// 引用边在 `child` 边之后插入:029 的 `edges_ai` 会按「有入 `link` 边」重算 `is_cited`,
/// 先写死 1 会被插 `child` 边时归零。
fn graph(c: &Connection) {
    ent(c, 1, "时间", 0, Some("时间"));
    ent(c, 2, "2026", 0, Some("时间/2026"));
    ent(c, 3, "08", 0, Some("时间/2026/08"));
    ent(c, 4, "季节", 0, Some("季节"));
    ent(c, 5, "春", 0, Some("季节/春"));
    ent(c, 6, "笔记", 0, None);
    edge(c, 1, 2, "child");
    edge(c, 2, 3, "child");
    edge(c, 4, 5, "child");
    edge(c, 6, 3, "link");
}

#[test]
fn closure_is_cited_plus_ancestors() {
    let c = db();
    graph(&c);
    assert_eq!(tree_closure_ids(&c).unwrap(), vec![1, 2, 3], "零入边根与被引用叶之间的祖先必须进闭包");
}

#[test]
fn in_tree_predicate_matches_closure_ids() {
    let c = db();
    graph(&c);
    let pred = in_tree_predicate("e");
    let mut stmt = c
        .prepare(&format!("SELECT e.id FROM entities e WHERE {pred} ORDER BY e.id"))
        .unwrap();
    let got: Vec<i64> = stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
    assert_eq!(got, tree_closure_ids(&c).unwrap(), "单实体判定与集合判定逐 id 一致");
    assert_eq!(got, vec![1, 2, 3]);
}

#[test]
fn sync_is_cited_tracks_link_edges() {
    let c = db();
    ent(&c, 1, "A", 0, Some("A"));
    ent(&c, 2, "B", 0, Some("B"));
    edge(&c, 1, 2, "child");
    sync_is_cited(&c, 2).unwrap();
    assert_eq!(cited(&c, 2), 0, "`child` 是结构边,不算引用");
    edge(&c, 1, 2, "link");
    sync_is_cited(&c, 2).unwrap();
    assert_eq!(cited(&c, 2), 1);
    c.execute("DELETE FROM edges WHERE kind = 'link'", []).unwrap();
    sync_is_cited(&c, 2).unwrap();
    assert_eq!(cited(&c, 2), 0, "撤销引用后回 0");
}
