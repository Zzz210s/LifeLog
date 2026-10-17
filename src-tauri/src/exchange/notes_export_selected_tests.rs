//! 「导出选中」用例(spec 2026-10-17 §4.4):只导出给定 id、行数与列结构不变、空集给纯表头工作簿。
use super::{export_selected, rows_selected};
use crate::db::migrate;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn seed(c: &Connection) {
    c.execute_batch(
        "INSERT INTO points(id, meta, created_at, path, depth) VALUES
           (1, '甲', '2026-01-01', NULL, NULL),
           (2, '乙', '2026-01-02', NULL, NULL),
           (3, '丙', '2026-01-03', NULL, NULL),
           (10, '标签', '2026-01-01', '标签', 1);
         INSERT INTO lines(id, from_id, to_id, name_id) VALUES (100, 1, 10, NULL);",
    )
    .unwrap();
}

#[test]
fn exports_only_the_selected_ids() {
    let c = db();
    seed(&c);
    let rows = rows_selected(&c, &[1, 3]).unwrap();
    assert_eq!(rows.iter().map(|r| r.id).collect::<Vec<_>>(), vec![3, 1], "行序仍是 id 降序");
    assert_eq!(rows[1].refs, "标签", "引用列口径与整库导出同一份");
}

#[test]
fn skips_unknown_ids() {
    let c = db();
    seed(&c);
    let rows = rows_selected(&c, &[999, 2]).unwrap();
    assert_eq!(rows.iter().map(|r| r.id).collect::<Vec<_>>(), vec![2]);
}

#[test]
fn empty_selection_yields_header_only_workbook() {
    let c = db();
    seed(&c);
    assert!(rows_selected(&c, &[]).unwrap().is_empty());
    assert!(!export_selected(&c, &[]).unwrap().is_empty(), "空集也要是合法 xlsx(只有表头)");
}
