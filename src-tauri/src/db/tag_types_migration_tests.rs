//! 迁移 021(标签类型收进标签系统)读数:tags.is_type 列、roles/tag_roles 消失、
//! 升级路径与重放幂等、user_version = 21。
use super::*;

fn col_exists(conn: &Connection, table: &str, column: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        rusqlite::params![table, column],
        |r| r.get::<_, i64>(0),
    )
    .unwrap()
        > 0
}

fn table_exists(conn: &Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        rusqlite::params![table],
        |r| r.get::<_, i64>(0),
    )
    .unwrap()
        > 0
}

#[test]
fn fresh_db_has_is_type_and_no_role_tables() {
    let c = Connection::open_in_memory().unwrap();
    run(&c).unwrap();
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, latest_version());
    assert_eq!(latest_version(), 21);
    assert!(col_exists(&c, "tags", "is_type"));
    assert!(!table_exists(&c, "roles") && !table_exists(&c, "tag_roles"));
}

#[test]
fn migration_021_is_idempotent_when_replayed() {
    let c = Connection::open_in_memory().unwrap();
    run(&c).unwrap();
    // 直接重放 021 两次:ADD COLUMN 钩子已见过列 -> 空操作,DROP TABLE IF EXISTS 可重放
    apply(&c, MIGRATIONS[20], 21).unwrap();
    apply(&c, MIGRATIONS[20], 21).unwrap();
    assert!(col_exists(&c, "tags", "is_type"));
}

#[test]
fn upgrade_from_v20_drops_role_tables_and_keeps_tags() {
    let c = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(20) {
        apply(&c, sql, (i + 1) as i64).unwrap();
    }
    c.execute(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES('中国', NULL, '中国', 1)",
        [],
    )
    .unwrap();
    c.execute("INSERT INTO roles(tag_id, sort_order) VALUES(1, 0)", []).unwrap();
    c.execute("INSERT INTO tag_roles(tag_id, role_id) VALUES(1, 1)", []).unwrap();

    run(&c).unwrap();

    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 21);
    assert!(!table_exists(&c, "roles") && !table_exists(&c, "tag_roles"));
    let kept: i64 = c
        .query_row("SELECT COUNT(*) FROM tags WHERE path='中国' AND is_type=0", [], |r| r.get(0))
        .unwrap();
    assert_eq!(kept, 1, "存量标签保留且 is_type 默认 0(不自动登记)");
}
