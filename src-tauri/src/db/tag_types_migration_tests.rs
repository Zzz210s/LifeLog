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
fn upgrade_from_v20_migrates_role_rows_and_drops_role_tables() {
    let c = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(20) {
        apply(&c, sql, (i + 1) as i64).unwrap();
    }
    c.execute(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES('国籍', NULL, '国籍', 1)",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES('中国', NULL, '中国', 1)",
        [],
    )
    .unwrap();
    c.execute("INSERT INTO tags(name, parent_id, path, depth) VALUES('书', NULL, '书', 1)", [])
        .unwrap();
    // 旧模型:国籍(id=1)是登记的角色;中国(id=2)认领它;书(id=3)没登记
    c.execute("INSERT INTO roles(tag_id, sort_order) VALUES(1, 0)", []).unwrap();
    c.execute("INSERT INTO tag_roles(tag_id, role_id) VALUES(2, 1)", []).unwrap();

    run(&c).unwrap();

    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 21);
    assert!(!table_exists(&c, "roles") && !table_exists(&c, "tag_roles"));
    let flagged: Vec<String> = {
        let mut st = c.prepare("SELECT path FROM tags WHERE is_type = 1 ORDER BY path").unwrap();
        let rows = st.query_map([], |r| r.get(0)).unwrap();
        rows.collect::<Result<_, _>>().unwrap()
    };
    assert_eq!(flagged, vec!["国籍"], "roles 行搬成 is_type=1,未登记的标签仍是 0");
    let edge: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM tag_links WHERE tag_id=2 AND target_type='type' AND target_id=1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(edge, 1, "tag_roles 行搬成 'type' 边(中国 认领 国籍)");
}

#[test]
fn crash_replay_after_hooks_keeps_migration_idempotent() {
    // 「钩子已 ADD COLUMN 且已搬完、版本仍 20」的崩溃重放:run() 不得报 duplicate column,
    // 也不得把 'type' 边搬第二遍
    let c = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(20) {
        apply(&c, sql, (i + 1) as i64).unwrap();
    }
    c.execute(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES('国籍', NULL, '国籍', 1)",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES('中国', NULL, '中国', 1)",
        [],
    )
    .unwrap();
    c.execute("INSERT INTO roles(tag_id, sort_order) VALUES(1, 0)", []).unwrap();
    c.execute("INSERT INTO tag_roles(tag_id, role_id) VALUES(2, 1)", []).unwrap();

    super::migration_hooks::ensure_is_type_column(&c).unwrap();
    super::migration_hooks::carry_over_role_tables(&c).unwrap();

    run(&c).unwrap();

    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 21);
    let edges: i64 = c
        .query_row("SELECT COUNT(*) FROM tag_links WHERE target_type='type'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(edges, 1, "搬迁幂等:重放不新增第二条 'type' 边");
}
