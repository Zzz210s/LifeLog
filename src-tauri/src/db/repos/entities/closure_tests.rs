//! T1.4 祖先闭包与 `is_cited` 增量维护(spec §3.1 / §3.3 / §5.4-①)。
//! 夹具 = 全新库(`migrate::run` 到最新 v31),直接读写 `points` / `lines`(点位/线条)。
use super::closure::{in_tree_predicate, sync_is_cited, tree_closure_ids};
use crate::db::migrate;
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 建点:`path` 给出即树内节点,`None` = 树外(笔记形态);`cited` 直写 `is_cited`。
fn ent(c: &Connection, id: i64, meta: &str, cited: i64, path: Option<&str>) {
    let depth = path.map(|p| p.matches('/').count() as i64 + 1);
    c.execute(
        "INSERT INTO points(id, meta, is_cited, created_at, parent_id, path, depth)
         VALUES(?1, ?2, ?3, '2026-01-01T00:00:00.000', NULL, ?4, ?5)",
        params![id, meta, cited, path, depth],
    )
    .unwrap();
}

/// 画线:`name_id = 0` = 子级线(结构),`None` = 无名字线(v30 的 `link` 引用)。
fn line(c: &Connection, from: i64, to: i64, name_id: Option<i64>) {
    c.execute(
        "INSERT INTO lines(from_id, to_id, name_id)
         VALUES(?1, ?2, ?3)",
        params![from, to, name_id],
    )
    .unwrap();
}

fn cited(c: &Connection, id: i64) -> i64 {
    c.query_row("SELECT is_cited FROM points WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

/// `1 -> 2 -> 3`(3 被笔记 6 引用);`4 -> 5` 整条无被引用后代,不进闭包。
/// 引用线在子级线之后插入:031 的 `lines_ai` 会按「有入非子级线」重算 `is_cited`,
/// 先写死 1 会被插子级线时归零。
fn graph(c: &Connection) {
    ent(c, 1, "时间", 0, Some("时间"));
    ent(c, 2, "2026", 0, Some("时间/2026"));
    ent(c, 3, "08", 0, Some("时间/2026/08"));
    ent(c, 4, "季节", 0, Some("季节"));
    ent(c, 5, "春", 0, Some("季节/春"));
    ent(c, 6, "笔记", 0, None);
    line(c, 1, 2, Some(0));
    line(c, 2, 3, Some(0));
    line(c, 4, 5, Some(0));
    line(c, 6, 3, None);
}

#[test]
fn closure_is_cited_plus_ancestors() {
    let c = db();
    graph(&c);
    assert_eq!(tree_closure_ids(&c).unwrap(), vec![1, 2, 3], "零入线根与被引用叶之间的祖先必须进闭包");
}

/// 变异的靶子:闭包种子必须是 `is_cited = 1`,**不是全部点**。
/// 把 `CLOSURE_CTE` 的种子改成 `SELECT id FROM points`(去掉 `WHERE is_cited = 1`)本用例变红:
/// 未引用子树 `4 -> 5` 与树外笔记 6 会被一起卷进闭包。
#[test]
fn closure_starts_from_cited_not_all_points() {
    let c = db();
    graph(&c);
    let ids = tree_closure_ids(&c).unwrap();
    assert_eq!(ids, vec![1, 2, 3]);
    for absent in [4, 5, 6] {
        assert!(!ids.contains(&absent), "点 {absent} 无被引用后代,不得进闭包:{ids:?}");
    }
}

#[test]
fn in_tree_predicate_matches_closure_ids() {
    let c = db();
    graph(&c);
    let pred = in_tree_predicate("e");
    let mut stmt = c
        .prepare(&format!("SELECT e.id FROM points e WHERE {pred} ORDER BY e.id"))
        .unwrap();
    let got: Vec<i64> = stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
    assert_eq!(got, tree_closure_ids(&c).unwrap(), "单实体判定与集合判定逐 id 一致");
    assert_eq!(got, vec![1, 2, 3]);
}

#[test]
fn sync_is_cited_tracks_link_lines() {
    let c = db();
    ent(&c, 1, "A", 0, Some("A"));
    ent(&c, 2, "B", 0, Some("B"));
    line(&c, 1, 2, Some(0));
    sync_is_cited(&c, 2).unwrap();
    assert_eq!(cited(&c, 2), 0, "子级线是结构线,不算引用");
    line(&c, 1, 2, None);
    sync_is_cited(&c, 2).unwrap();
    assert_eq!(cited(&c, 2), 1);
    c.execute("DELETE FROM lines WHERE name_id IS NULL", []).unwrap();
    sync_is_cited(&c, 2).unwrap();
    assert_eq!(cited(&c, 2), 0, "撤销引用后回 0");
}
