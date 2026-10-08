//! T1.0 spec §3.7 七条对账(mock v28 库):正例 + 逐条反例 + 重复跑不变
//! + 真库副本只读验收(`#[ignore]`)。028 落地前用 `links` 真源顶 `entity_name`/`entity_key`。
use rusqlite::functions::FunctionFlags;
use rusqlite::{params, Connection};

use super::reconcile::{
    assert_cache_matches_edges, assert_is_cited_matches_edges, check_1_is_cited, check_2_parent_child,
    check_3_path, check_4_depth, check_5_single_parent, check_6_sibling_key, check_7_id_contiguous, counts,
};

const SCHEMA: &str = "
CREATE TABLE entities(id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '', is_cited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '', parent_id INTEGER, path TEXT, depth INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE edges(id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, target_id INTEGER NOT NULL,
  kind TEXT NOT NULL, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '',
  UNIQUE(source_id, kind, target_id));";

/// `entity_name` / `entity_key` 由连接注册(db/sql_functions.rs,T1.1 落地);此处用 `links` 真源顶上。
fn register_meta_fns(c: &Connection) {
    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
    c.create_scalar_function("entity_name", 1, flags, |ctx| {
        let s: String = ctx.get(0)?;
        Ok(crate::links::display_title(&s))
    })
    .unwrap();
    c.create_scalar_function("entity_key", 1, flags, |ctx| {
        let s: String = ctx.get(0)?;
        Ok(crate::links::title_of(&s))
    })
    .unwrap();
}

fn add_entity(c: &Connection, id: i64, meta: &str, cited: i64, parent: Option<i64>, path: Option<&str>, depth: Option<i64>) {
    c.execute(
        "INSERT INTO entities(id, meta, is_cited, parent_id, path, depth) VALUES(?1,?2,?3,?4,?5,?6)",
        params![id, meta, cited, parent, path, depth],
    )
    .unwrap();
}

fn add_edge(c: &Connection, source: i64, target: i64, kind: &str) {
    c.execute(
        "INSERT INTO edges(source_id, target_id, kind) VALUES(?1,?2,?3)",
        params![source, target, kind],
    )
    .unwrap();
}

/// 一致夹具:根 1(工作)+ 子 2(项目,被笔记 3 引用)+ 笔记 3;child 1->2、link 3->2。
fn consistent() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    register_meta_fns(&c);
    add_entity(&c, 1, "工作", 0, None, Some("工作"), Some(1));
    add_entity(&c, 2, "项目", 1, Some(1), Some("工作/项目"), Some(2));
    add_entity(&c, 3, "第一篇\n正文", 0, None, None, None);
    add_edge(&c, 1, 2, "child");
    add_edge(&c, 3, 2, "link");
    c
}

/// 正例:七条对账全过;计数与库一致(mock 无老 `tags` 表 -> None)。
#[test]
fn consistent_entity_cache_passes_seven() {
    let c = consistent();
    assert_cache_matches_edges(&c);
    assert_is_cited_matches_edges(&c);
    let n = counts(&c).unwrap();
    assert_eq!(n.tags, None, "mock v28 无老 tags 表");
    assert_eq!((n.entities, n.child, n.link), (Some(3), Some(1), Some(1)));
}

/// 逐条反例:每种漂移至少被对应那一条命中。
#[test]
fn each_check_detects_its_drift() {
    type CheckFn = fn(&Connection) -> rusqlite::Result<Vec<String>>;
    type MutFn = fn(&Connection);
    let cases: [(&str, CheckFn, MutFn); 7] = [
        ("1", check_1_is_cited, |c| {
            c.execute("UPDATE entities SET is_cited=1 WHERE id=1", []).unwrap();
        }),
        ("2", check_2_parent_child, |c| {
            c.execute("UPDATE entities SET parent_id=NULL WHERE id=2", []).unwrap();
        }),
        ("3", check_3_path, |c| {
            c.execute("UPDATE entities SET path='工作/项目X' WHERE id=2", []).unwrap();
        }),
        ("4", check_4_depth, |c| {
            c.execute("UPDATE entities SET depth=9 WHERE id=2", []).unwrap();
        }),
        ("5", check_5_single_parent, |c| add_edge(c, 3, 2, "child")),
        ("6", check_6_sibling_key, |c| {
            add_entity(c, 4, "项目", 1, Some(1), Some("工作/项目"), Some(2));
        }),
        ("7", check_7_id_contiguous, |c| add_entity(c, 9, "离号", 0, None, None, None)),
    ];
    for (n, check, mutate) in cases {
        let c = consistent();
        mutate(&c);
        let rows = check(&c).unwrap();
        assert!(!rows.is_empty(), "第 {n} 条未命中漂移: {rows:?}");
    }
}

/// `assert_is_cited_matches_edges` 对漂移必须 panic(spec §3.1 专用断言)。
#[test]
#[should_panic(expected = "is_cited")]
fn assert_is_cited_panics_on_drift() {
    let c = consistent();
    c.execute("UPDATE entities SET is_cited=1 WHERE id=1", []).unwrap();
    assert_is_cited_matches_edges(&c);
}

/// 重复跑对账不变:同一库连跑两次,计数与结果一致。
#[test]
fn reconcile_repeat_run_is_stable() {
    let c = consistent();
    let before = counts(&c).unwrap();
    assert_cache_matches_edges(&c);
    assert_cache_matches_edges(&c);
    assert_eq!(before, counts(&c).unwrap());
}

/// 真库副本只读验收(默认跳过)。用法:
/// `LIFELOG_RECONCILE_DB=F:/0-code/_lifelog-snapshots/<副本>.db \
///  cargo test --lib reconcile_real_db_readonly -- --ignored --nocapture`
#[test]
#[ignore = "真库只读验收:需 LIFELOG_RECONCILE_DB 指向 v28 结构的副本"]
fn reconcile_real_db_readonly() {
    let path = std::env::var("LIFELOG_RECONCILE_DB")
        .expect("未设 LIFELOG_RECONCILE_DB(指向副本路径)");
    let c = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    register_meta_fns(&c);
    assert_cache_matches_edges(&c);
    println!("真库副本读数: {:?}", counts(&c).unwrap());
}
