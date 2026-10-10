//! T1.0 spec §5.4 十条对账(v31 点/线夹具):正例 + 逐条反例 + 合并态放宽 + 重复跑不变
//! + 真库副本只读验收(`#[ignore]`)。`entity_name`/`entity_key` 由连接注册,测试里用 `links` 真源顶上。
use rusqlite::functions::FunctionFlags;
use rusqlite::{params, Connection};

use super::reconcile::{assert_cache_matches_edges, assert_is_cited_matches_edges};
use super::reconcile_checks::{
    check_10_settings_refs, check_1_is_cited, check_2_parent_child, check_3_path, check_4_depth,
    check_5_single_parent, check_6_sibling_key, check_7_id_integrity, check_8_pure_name,
    check_9_reserved_point, counts,
};

const SCHEMA: &str = "
CREATE TABLE points(id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '', is_cited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '', parent_id INTEGER, path TEXT, depth INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE lines(id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, name_id INTEGER,
  created_at TEXT NOT NULL DEFAULT '', UNIQUE(from_id, to_id, name_id));
CREATE VIRTUAL TABLE points_fts USING fts5(meta, paths);
CREATE TABLE entity_merge_log(id INTEGER PRIMARY KEY, source_entity_id INTEGER, target_entity_id INTEGER);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');";

/// `entity_name` / `entity_key` 由连接注册(db/sql_functions.rs);此处用 `links` 真源顶上。
fn register_meta_fns(c: &Connection) {
    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
    c.create_scalar_function("entity_name", 1, flags, |ctx| {
        Ok(crate::links::display_title(&ctx.get::<String>(0)?))
    })
    .unwrap();
    c.create_scalar_function("entity_key", 1, flags, |ctx| {
        Ok(crate::links::title_of(&ctx.get::<String>(0)?))
    })
    .unwrap();
}

fn add_point(c: &Connection, id: i64, meta: &str, cited: i64, parent: Option<i64>, path: Option<&str>, depth: Option<i64>) {
    c.execute(
        "INSERT INTO points(id, meta, is_cited, parent_id, path, depth) VALUES(?1,?2,?3,?4,?5,?6)",
        params![id, meta, cited, parent, path, depth],
    )
    .unwrap();
}

fn add_line(c: &Connection, from: i64, to: i64, name: Option<i64>) {
    c.execute(
        "INSERT INTO lines(from_id, to_id, name_id) VALUES(?1,?2,?3)",
        params![from, to, name],
    )
    .unwrap();
}

/// 一致夹具:保留点 0(子级)、内容点 1(工作)/2(项目)/3(笔记)、关系名点 4(国籍)。
/// 子级线 1->2;无名线 3->2;有名线 3->1(name=国籍)。`is_cited` = 有入非子级线。
fn consistent() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    register_meta_fns(&c);
    add_point(&c, 0, "子级", 0, None, None, None);
    add_point(&c, 1, "工作", 1, None, Some("工作"), Some(1));
    add_point(&c, 2, "项目", 1, Some(1), Some("工作/项目"), Some(2));
    add_point(&c, 3, "第一篇\n正文", 0, None, None, None);
    add_point(&c, 4, "国籍", 0, None, None, None);
    add_line(&c, 1, 2, Some(0));
    add_line(&c, 3, 2, None);
    add_line(&c, 3, 1, Some(4));
    c.execute("INSERT INTO points_fts(rowid, meta) VALUES(1,'工作'),(2,'项目'),(3,'第一篇')", []).unwrap();
    c.execute("INSERT INTO settings(key, value) VALUES('tree_line_name_id','0'),('graph_positions','{\"1\":{\"x\":0}}'),('ui.mru.notes','[{\"id\":\"3\"}]')", []).unwrap();
    c
}

/// 正例:十条对账全过;计数与库一致。
#[test]
fn consistent_points_pass_ten() {
    let c = consistent();
    assert_cache_matches_edges(&c);
    assert_is_cited_matches_edges(&c);
    let n = counts(&c).unwrap();
    assert_eq!(
        (n.points, n.lines, n.lines_tree, n.lines_named, n.lines_unnamed, n.pure_name_points, n.is_cited),
        (Some(5), Some(3), Some(1), Some(1), Some(1), Some(2), Some(2))
    );
}

/// 逐条反例:每种漂移至少被对应那一条命中。
#[test]
fn each_check_detects_its_drift() {
    type CheckFn = fn(&Connection) -> rusqlite::Result<Vec<String>>;
    type MutFn = fn(&Connection);
    let cases: [(&str, CheckFn, MutFn); 10] = [
        ("1", check_1_is_cited, |c| {
            c.execute("UPDATE points SET is_cited=0 WHERE id=2", []).unwrap();
        }),
        ("2", check_2_parent_child, |c| {
            c.execute("UPDATE points SET parent_id=NULL WHERE id=2", []).unwrap();
        }),
        ("3", check_3_path, |c| {
            c.execute("UPDATE points SET path='工作/项目X' WHERE id=2", []).unwrap();
        }),
        ("4", check_4_depth, |c| {
            c.execute("UPDATE points SET depth=9 WHERE id=2", []).unwrap();
        }),
        ("5", check_5_single_parent, |c| add_line(c, 3, 2, Some(0))),
        ("6", check_6_sibling_key, |c| add_point(c, 5, "项目", 1, Some(1), Some("工作/项目"), Some(2))),
        ("7", check_7_id_integrity, |c| add_point(c, 9, "离号", 0, None, None, None)),
        ("8", check_8_pure_name, |c| {
            c.execute("UPDATE points SET path='国籍' WHERE id=4", []).unwrap();
        }),
        ("9", check_9_reserved_point, |c| {
            c.execute("UPDATE settings SET value='9' WHERE key='tree_line_name_id'", []).unwrap();
        }),
        ("10", check_10_settings_refs, |c| {
            c.execute("UPDATE settings SET value='{\"9\":{\"x\":0}}' WHERE key='graph_positions'", []).unwrap();
        }),
    ];
    for (n, check, mutate) in cases {
        let c = consistent();
        mutate(&c);
        let rows = check(&c).unwrap();
        assert!(!rows.is_empty(), "第 {n} 条未命中漂移: {rows:?}");
    }
}

/// ⑦ 放宽后的合并态:有合并记录时断号不再判失败(自动合并与引用优化 A3 都会删点)。
#[test]
fn check_7_allows_gaps_once_a_merge_was_logged() {
    let c = consistent();
    add_point(&c, 9, "离号", 0, None, None, None);
    assert!(!check_7_id_integrity(&c).unwrap().is_empty(), "无合并记录时断号应仍命中");
    c.execute("INSERT INTO entity_merge_log(id, source_entity_id, target_entity_id) VALUES(1, 8, 2)", []).unwrap();
    assert!(check_7_id_integrity(&c).unwrap().is_empty(), "有合并记录后断号应放过");
}

/// `assert_is_cited_matches_edges` 对漂移必须 panic(spec §5.4-① 专用断言)。
#[test]
#[should_panic(expected = "is_cited")]
fn assert_is_cited_panics_on_drift() {
    let c = consistent();
    c.execute("UPDATE points SET is_cited=0 WHERE id=2", []).unwrap();
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
#[ignore = "真库只读验收:需 LIFELOG_RECONCILE_DB 指向 v31 结构的副本"]
fn reconcile_real_db_readonly() {
    let path = std::env::var("LIFELOG_RECONCILE_DB")
        .expect("未设 LIFELOG_RECONCILE_DB(指向副本路径)");
    let c = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    register_meta_fns(&c);
    assert_cache_matches_edges(&c);
    println!("真库副本读数: {:?}", counts(&c).unwrap());
}
