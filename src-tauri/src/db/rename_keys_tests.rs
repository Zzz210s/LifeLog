//! 005 设置键更名迁移测试:quick_* -> input_*。
//! 关注三件事:值随键一起搬走且旧键删除、重复执行无副作用、没有旧键时不动任何数据。
use super::{run, MIGRATIONS};
use rusqlite::Connection;

/// 模拟升级前的旧库:应用到 005 之前为止
fn old_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    for sql in &MIGRATIONS[..MIGRATIONS.len() - 1] {
        conn.execute_batch(sql).unwrap();
    }
    conn.pragma_update(None, "user_version", (MIGRATIONS.len() - 1) as i64)
        .unwrap();
    conn
}

fn rows(conn: &Connection) -> Vec<(String, String)> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key").unwrap();
    let out = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    out
}

#[test]
fn migration_005_renames_old_keys_and_drops_them() {
    let conn = old_db();
    conn.execute_batch(
        "INSERT INTO settings(key, value) VALUES
           ('quick_x', '1077'), ('quick_zoom', '1.30'), ('quick_geom_ver', '1'),
           ('unrelated', 'keep'), ('xquick_y', 'untouched'), ('quickfool', 'untouched');",
    )
    .unwrap();

    run(&conn).unwrap();

    assert_eq!(
        rows(&conn),
        vec![
            ("input_geom_ver".into(), "1".into()),
            ("input_x".into(), "1077".into()),
            ("input_zoom".into(), "1.30".into()),
            ("quickfool".into(), "untouched".into()),
            ("unrelated".into(), "keep".into()),
            ("xquick_y".into(), "untouched".into()),
        ]
    );
}

#[test]
fn migration_005_prefers_existing_new_key_on_conflict() {
    let conn = old_db();
    conn.execute_batch(
        "INSERT INTO settings(key, value) VALUES ('quick_x', '1'), ('input_x', '2');",
    )
    .unwrap();

    run(&conn).unwrap();

    assert_eq!(rows(&conn), vec![("input_x".into(), "2".into())]);
}

#[test]
fn migration_005_is_idempotent() {
    let conn = old_db();
    conn.execute_batch("INSERT INTO settings(key, value) VALUES ('quick_x', '5');")
        .unwrap();
    let sql = MIGRATIONS.last().unwrap();

    // 直接重复执行迁移 SQL 本体:第二次必须是无副作用的空操作
    conn.execute_batch(sql).unwrap();
    let after_first = rows(&conn);
    conn.execute_batch(sql).unwrap();

    assert_eq!(rows(&conn), after_first);
    assert_eq!(after_first, vec![("input_x".into(), "5".into())]);
}

#[test]
fn migration_005_without_old_keys_changes_nothing() {
    let conn = old_db();
    conn.execute_batch("INSERT INTO settings(key, value) VALUES ('unrelated', 'keep');")
        .unwrap();

    run(&conn).unwrap();

    assert_eq!(rows(&conn), vec![("unrelated".into(), "keep".into())]);
}
