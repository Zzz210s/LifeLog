//! T1.4 孤儿回收新判据(无出线 且 无**非子级线**入线,子级线不算)与「拖入树补无名字线」。
//! 夹具 = 全新库(`migrate::run` 到最新 v31),直接读写 `points` / `lines`。
use super::*;
use crate::db::migrate;
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn ent(c: &Connection, id: i64, meta: &str, cited: i64, path: Option<&str>) {
    let depth = path.map(|p| p.matches('/').count() as i64 + 1);
    c.execute(
        "INSERT INTO points(id, meta, is_cited, created_at, parent_id, path, depth)
         VALUES(?1, ?2, ?3, '2026-01-01T00:00:00.000', NULL, ?4, ?5)",
        params![id, meta, cited, path, depth],
    )
    .unwrap();
}

fn edge(c: &Connection, source: i64, target: i64, kind: &str) {
    let name_id: Option<i64> = if kind == "child" { Some(0) } else { None };
    c.execute(
        "INSERT INTO lines(from_id, to_id, name_id)
         VALUES(?1, ?2, ?3)",
        params![source, target, name_id],
    )
    .unwrap();
}

fn ids(c: &Connection, sql: &str) -> Vec<i64> {
    let mut stmt = c.prepare(sql).unwrap();
    stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 老判据(入线不是子级线)与新判据(入无名字线)在只存在子级线/无名字线的库上等价。
const OLD_SET: &str = "SELECT id FROM points WHERE path IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM lines x WHERE x.from_id = points.id)
   AND NOT EXISTS(SELECT 1 FROM lines y WHERE y.to_id = points.id AND (y.name_id IS NULL OR y.name_id <> 0))";
const NEW_SET: &str = "SELECT id FROM points WHERE path IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM lines x WHERE x.from_id = points.id)
   AND NOT EXISTS(SELECT 1 FROM lines y WHERE y.to_id = points.id AND y.name_id IS NULL)";

#[test]
fn gc_predicate_equals_legacy_kind_not_child() {
    let c = db();
    ent(&c, 1, "工作", 0, Some("工作"));
    ent(&c, 2, "项目", 0, Some("工作/项目"));
    ent(&c, 3, "空壳", 0, Some("工作/空壳"));
    edge(&c, 1, 2, "child");
    edge(&c, 3, 2, "link");
    let mut old = ids(&c, OLD_SET);
    let mut new = ids(&c, NEW_SET);
    old.sort_unstable();
    new.sort_unstable();
    assert_eq!(old, new, "只剩子级线/无名字线两种形态后两条入线判据等价");
    assert_eq!(new, Vec::<i64>::new(), "2 有无名字线入线、3 有出线,都不是孤儿");
}

#[test]
fn gc_collects_dead_chain_layer_by_layer() {
    let c = db();
    ent(&c, 1, "时间", 0, Some("时间"));
    ent(&c, 2, "2026", 0, Some("时间/2026"));
    ent(&c, 3, "10", 0, Some("时间/2026/10"));
    ent(&c, 4, "08", 0, Some("时间/2026/10/08"));
    ent(&c, 5, "笔记", 0, None);
    edge(&c, 1, 2, "child");
    edge(&c, 2, 3, "child");
    edge(&c, 3, 4, "child");
    edge(&c, 5, 4, "link");
    // 另一支有引用,GC 后必须原样保留
    ent(&c, 10, "地点", 0, Some("地点"));
    ent(&c, 11, "日本", 1, Some("地点/日本"));
    edge(&c, 10, 11, "child");
    ent(&c, 12, "笔记2", 0, None);
    edge(&c, 12, 11, "link");

    c.execute("DELETE FROM points WHERE id = 5", []).unwrap();
    gc_orphans(&c).unwrap();

    assert_eq!(ids(&c, "SELECT id FROM points WHERE id IN (1,2,3,4)"), Vec::<i64>::new(), "死链逐层回收");
    assert_eq!(ids(&c, "SELECT id FROM points WHERE id IN (10,11,12) ORDER BY id"), vec![10, 11, 12]);
}

#[test]
fn drop_into_tree_adds_child_and_link_then_removal_clears_cited() {
    let c = db();
    ent(&c, 1, "工作", 0, Some("工作"));
    ent(&c, 20, "待归档笔记", 0, None);
    crate::db::repos::tags::write::drop_into_tree(&c, 1, 20).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines WHERE from_id=1 AND to_id=20 AND name_id=0"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines WHERE from_id=1 AND to_id=20 AND name_id IS NULL"), 1);
    assert_eq!(count(&c, "SELECT is_cited FROM points WHERE id=20"), 1, "被放置 = 被引用");

    c.execute("DELETE FROM lines WHERE from_id=1 AND to_id=20 AND name_id IS NULL", []).unwrap();
    crate::db::repos::entities::closure::sync_is_cited(&c, 20).unwrap();
    assert_eq!(count(&c, "SELECT is_cited FROM points WHERE id=20"), 0, "从树移除后回 0");
    assert_eq!(
        c.query_row("SELECT meta FROM points WHERE id=20", [], |r| r.get::<_, String>(0)).unwrap(),
        "待归档笔记",
        "meta 保留"
    );
}

/// T3.3 用例①:名字点随线存在 —— 仍有引用不回收,失去最后一条引用后由第二段回收
#[test]
fn gc_collects_orphan_name_point_after_last_line_removed() {
    let c = db();
    ent(&c, 1, "甲", 0, Some("甲"));
    ent(&c, 2, "乙", 0, Some("乙"));
    ent(&c, 3, "国籍", 0, None);
    c.execute(
        "INSERT INTO lines(from_id, to_id, name_id)
         VALUES(1, 2, 3)",
        [],
    )
    .unwrap();
    queue_name_point_gc(&c, 3).unwrap();
    gc_orphans(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE id=3"), 1, "仍被线引用:不回收");
    c.execute("DELETE FROM lines WHERE name_id = 3", []).unwrap();
    queue_name_point_gc(&c, 3).unwrap();
    gc_orphans(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE id=3"), 0, "失去最后引用:回收");
}

/// T3.3 用例①(保护):保留点 `子级`(id=0)即使被登记也恒不回收(spec §6.2 第一层)
#[test]
fn gc_keeps_reserved_tree_name_point() {
    let c = db();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE id=0"), 1, "空库也有保留点");
    queue_name_point_gc(&c, 0).unwrap();
    gc_orphans(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE id=0"), 1, "保留点恒受保护");
}
