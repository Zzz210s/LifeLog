//! T1.4 保留点自愈:恢复只依赖 `parent_id` 缓存、settings 悬空必须报错、健康时零副作用,
//! 外加 v31 副本上的真库验收(`#[ignore]`,会写副本)。
use rusqlite::Connection;

use super::reconcile_checks::{check_2_parent_child, check_5_single_parent, check_9_reserved_point};
use super::reserved::{
    ensure_reserved_name_point, recover_tree_lines, verify_reserved_name_point, TREE_NAME_ID,
};

/// 与 031 同形的 v31 最小结构:FK CASCADE + 表达式唯一索引(恢复必须与真实库同约束)。
const SCHEMA: &str = "
CREATE TABLE points(id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '', is_cited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '', color TEXT, parent_id INTEGER, path TEXT, depth INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE lines(id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  name_id INTEGER REFERENCES points(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT '', CHECK (from_id <> to_id));
CREATE UNIQUE INDEX idx_lines_uniq ON lines(from_id, to_id, COALESCE(name_id, -1));
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);";

/// 保留点 0(子级)+ 树 1->2->3、1->4(3 条子级线)+ 笔记 5 对 1 的无名线。
/// 有父的点 3 个,`parent_id` 缓存与子级线一一对应。
fn fixture() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    c.execute_batch(SCHEMA).unwrap();
    c.execute_batch(
        "INSERT INTO points(id, meta, is_cited, parent_id, path, depth) VALUES
           (0, '子级', 0, NULL, NULL, NULL),
           (1, '工作', 0, NULL, '工作', 1),
           (2, '项目', 0, 1, '工作/项目', 2),
           (3, '子项目', 0, 2, '工作/项目/子项目', 3),
           (4, '跨级', 0, 1, '工作/跨级', 2),
           (5, '一条笔记', 1, NULL, NULL, NULL);
         INSERT INTO lines(id, from_id, to_id, name_id) VALUES
           (1, 1, 2, 0), (2, 2, 3, 0), (3, 1, 4, 0), (4, 5, 1, NULL);
         INSERT INTO settings(key, value) VALUES('tree_line_name_id', '0');",
    )
    .unwrap();
    c
}

fn scalar(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn tree_lines(c: &Connection) -> i64 {
    scalar(c, "SELECT COUNT(*) FROM lines WHERE name_id = 0")
}

fn total_lines(c: &Connection) -> i64 {
    scalar(c, "SELECT COUNT(*) FROM lines")
}

fn pair_lines(c: &Connection, from: i64, to: i64) -> i64 {
    scalar(
        c,
        &format!("SELECT COUNT(*) FROM lines WHERE from_id = {from} AND to_id = {to}"),
    )
}

fn ten_ok(c: &Connection) {
    assert!(check_2_parent_child(c).unwrap().is_empty(), "对账 ② 应回绿");
    assert!(check_5_single_parent(c).unwrap().is_empty(), "对账 ⑤ 应回绿");
    assert!(check_9_reserved_point(c).unwrap().is_empty(), "对账 ⑨ 应回绿");
}

/// 用例 ①(spec §6.2):删掉保留点 -> 子级线被级联删空 -> 按 `parent_id` 缓存全部找回;
/// 线还在但名字被清空时改写回 `name_id = 0`,不能为同一对补第二条线。
#[test]
fn reserved_name_point_rebuilt_from_parent_cache() {
    let c = fixture();
    assert_eq!(tree_lines(&c), 3);

    // 阶段 A:真库的删除路径 —— 保留点被删,子级线随 FK 级联消失。
    c.execute("DELETE FROM points WHERE id = 0", []).unwrap();
    assert_eq!(tree_lines(&c), 0, "删保留点应级联删掉子级线");
    assert_eq!(total_lines(&c), 1, "只剩那条无名线");
    let rebuilt = recover_tree_lines(&c).unwrap();
    assert!(rebuilt.point_created, "保留点应被重建");
    assert_eq!(rebuilt.lines_fixed, 3);
    assert_eq!(tree_lines(&c), 3, "子级线应按 parent_id 缓存找回");
    assert_eq!(pair_lines(&c, 1, 2), 1, "同一对只能有一条子级线");
    ten_ok(&c);

    // 阶段 B:线还在、名字被清空 —— 必须改写回 name_id = 0,而不是补一条重复的线。
    c.execute("UPDATE lines SET name_id = NULL WHERE name_id = 0", []).unwrap();
    let rewritten = recover_tree_lines(&c).unwrap();
    assert!(!rewritten.point_created, "保留点还在时不该重建");
    assert_eq!(rewritten.lines_fixed, 3, "3 条线应被改写回 id 0");
    assert_eq!(tree_lines(&c), 3);
    assert_eq!(pair_lines(&c, 1, 2), 1, "不该为同一对补第二条线");
    assert_eq!(total_lines(&c), 4, "线总数不应增加");
    ten_ok(&c);
}

/// 用例 ②:`settings.tree_line_name_id` 悬空 -> 体检报「树线名字点缺失」,而不是静默通过;
/// 自愈把记录写回 0 后复查转健全。
#[test]
fn dangling_settings_id_is_reported_not_silently_accepted() {
    let c = fixture();
    c.execute("UPDATE settings SET value = '99' WHERE key = 'tree_line_name_id'", []).unwrap();
    let reason = verify_reserved_name_point(&c).unwrap().expect("悬空 id 必须报错");
    assert!(reason.contains("树线名字点缺失"), "{reason}");
    recover_tree_lines(&c).unwrap();
    assert_eq!(verify_reserved_name_point(&c).unwrap(), None);
}

/// 用例 ③:保留点存在且良好 -> 体检通过,自愈无副作用(不新建点、不改线数)。
#[test]
fn verify_healthy_reserved_point_has_no_side_effects() {
    let c = fixture();
    assert_eq!(verify_reserved_name_point(&c).unwrap(), None);
    assert!(!ensure_reserved_name_point(&c).unwrap());
    let before = (total_lines(&c), tree_lines(&c));
    let report = recover_tree_lines(&c).unwrap();
    assert!(!report.changed(), "{report:?}");
    assert_eq!((total_lines(&c), tree_lines(&c)), before, "健康库自愈不得动线");
    ten_ok(&c);
}

/// id = TREE_NAME_ID 被非保留点占用 -> 报错拒绝,不静默覆盖。
#[test]
fn occupied_id_zero_is_refused_instead_of_overwritten() {
    let c = fixture();
    c.execute("DELETE FROM points WHERE id = 0", []).unwrap();
    c.execute("INSERT INTO points(id, meta, path) VALUES(0, '别的点', NULL)", []).unwrap();
    let reason = verify_reserved_name_point(&c).unwrap().expect("meta 不符必须报错");
    assert!(reason.contains("不是保留名字点"), "{reason}");
    let err = recover_tree_lines(&c).unwrap_err().to_string();
    assert!(err.contains("已被非保留点占用"), "{err}");
}

/// v31 副本真库验收(默认跳过;只写副本,真库只读)。用法:
/// `LIFELOG_RESERVED_DB=<v31 副本路径> cargo test --lib reserved_real_db_copy -- --ignored --nocapture`
#[test]
#[ignore = "真库副本验收:需 LIFELOG_RESERVED_DB 指向 v31 副本(会写副本)"]
fn reserved_real_db_copy() {
    let path = std::env::var("LIFELOG_RESERVED_DB").expect("未设 LIFELOG_RESERVED_DB");
    let c = Connection::open(&path).unwrap();
    crate::db::sql_functions::register(&c).unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    assert_eq!(scalar(&c, "PRAGMA user_version"), 31);

    let before = (scalar(&c, "SELECT COUNT(*) FROM lines"), tree_lines(&c));
    println!("删除前 lines/tree = {before:?}");
    assert_eq!(before, (6403, 719));

    c.execute("DELETE FROM points WHERE id = 0", []).unwrap();
    println!("删保留点后 tree = {}", tree_lines(&c));
    assert_eq!(tree_lines(&c), 0);

    let report = recover_tree_lines(&c).unwrap();
    println!("自愈读数:{}", report.message());
    let after = (scalar(&c, "SELECT COUNT(*) FROM lines"), tree_lines(&c));
    println!("恢复后 lines/tree = {after:?}, points_fts = {}", scalar(&c, "SELECT COUNT(*) FROM points_fts"));
    assert_eq!(after, (6403, 719));
    assert_eq!(scalar(&c, "SELECT COUNT(*) FROM points_fts"), 2116);
    assert_eq!(verify_reserved_name_point(&c).unwrap(), None);
    crate::db::repos::entities::reconcile::assert_cache_matches_edges(&c);
    println!("十条对账 PASS");
}

/// 空树库:保留点被删、无子级线可恢复时也不能炸(对账十条已由 T1.2 覆盖)。
#[test]
fn recovery_on_empty_tree_is_a_noop_for_lines() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    c.execute_batch(SCHEMA).unwrap();
    c.execute_batch("INSERT INTO settings(key, value) VALUES('tree_line_name_id', '0');")
        .unwrap();
    let report = recover_tree_lines(&c).unwrap();
    assert!(report.point_created);
    assert_eq!(report.lines_fixed, 0);
    assert_eq!(verify_reserved_name_point(&c).unwrap(), None);
    ten_ok(&c);
    assert_eq!(TREE_NAME_ID, 0);
}
