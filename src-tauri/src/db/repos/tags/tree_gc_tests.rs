//! T1.4 孤儿回收新判据(无出边 且 无 `link` 入边,`child` 入边不算)与「拖入树补 `link`」。
//! 夹具 = 全新库(`migrate::run` 到最新 v29),直接读写 `entities` / `edges`。
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

fn ids(c: &Connection, sql: &str) -> Vec<i64> {
    let mut stmt = c.prepare(sql).unwrap();
    stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 老判据(入边 `y.kind <> 'child'`)与新判据(`y.kind = 'link'`)在 v28 上等价。
const OLD_SET: &str = "SELECT id FROM entities WHERE path IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM edges x WHERE x.source_id = entities.id)
   AND NOT EXISTS(SELECT 1 FROM edges y WHERE y.target_id = entities.id AND y.kind <> 'child')";
const NEW_SET: &str = "SELECT id FROM entities WHERE path IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM edges x WHERE x.source_id = entities.id)
   AND NOT EXISTS(SELECT 1 FROM edges y WHERE y.target_id = entities.id AND y.kind = 'link')";

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
    assert_eq!(old, new, "只剩 child/link 两种 kind 后两条入边判据等价");
    assert_eq!(new, Vec::<i64>::new(), "2 有 link 入边、3 有出边,都不是孤儿");
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

    c.execute("DELETE FROM entities WHERE id = 5", []).unwrap();
    gc_orphans(&c).unwrap();

    assert_eq!(ids(&c, "SELECT id FROM entities WHERE id IN (1,2,3,4)"), Vec::<i64>::new(), "死链逐层回收");
    assert_eq!(ids(&c, "SELECT id FROM entities WHERE id IN (10,11,12) ORDER BY id"), vec![10, 11, 12]);
}

#[test]
fn drop_into_tree_adds_child_and_link_then_removal_clears_cited() {
    let c = db();
    ent(&c, 1, "工作", 0, Some("工作"));
    ent(&c, 20, "待归档笔记", 0, None);
    crate::db::repos::tags::write::drop_into_tree(&c, 1, 20).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE source_id=1 AND target_id=20 AND kind='child'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE source_id=1 AND target_id=20 AND kind='link'"), 1);
    assert_eq!(count(&c, "SELECT is_cited FROM entities WHERE id=20"), 1, "被放置 = 被引用");

    c.execute("DELETE FROM edges WHERE source_id=1 AND target_id=20 AND kind='link'", []).unwrap();
    crate::db::repos::entities::closure::sync_is_cited(&c, 20).unwrap();
    assert_eq!(count(&c, "SELECT is_cited FROM entities WHERE id=20"), 0, "从树移除后回 0");
    assert_eq!(
        c.query_row("SELECT meta FROM entities WHERE id=20", [], |r| r.get::<_, String>(0)).unwrap(),
        "待归档笔记",
        "meta 保留"
    );
}
