//! 迁移 023(关系属性名存到边上)读数:tag_links 加 `remark` 列;幂等 / 可重放;
//! 存量边(本机真实库 24 条形态)原样保留、remark 取默认空串(不校验历史数据)。
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

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 与 run() 同序地迁到 22(001..020 + 021/022 各自的钩子与 SQL)
fn migrate_to_v22(c: &Connection) {
    for (i, sql) in MIGRATIONS.iter().enumerate().take(20) {
        apply(c, sql, (i + 1) as i64).unwrap();
    }
    migration_hooks::ensure_is_type_column(c).unwrap();
    migration_hooks::carry_over_role_tables(c).unwrap();
    apply(c, MIGRATIONS[20], 21).unwrap();
    migration_hooks::drop_is_type_column(c).unwrap();
    apply(c, MIGRATIONS[21], 22).unwrap();
}

fn add_tag(c: &Connection, id: i64, path: &str) {
    c.execute(
        "INSERT INTO tags(id, name, parent_id, path, depth) VALUES(?1, ?2, NULL, ?2, 1)",
        rusqlite::params![id, path],
    )
    .unwrap();
}

/// ① 新库跑到最新:tag_links 有 remark 列,user_version=23
#[test]
fn fresh_db_has_remark_column() {
    let c = Connection::open_in_memory().unwrap();
    run(&c).unwrap();
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(latest_version(), 23);
    assert_eq!(v, 23);
    assert!(col_exists(&c, "tag_links", "remark"), "023 后 tag_links 必须有 remark 列");
}

/// ② v22 升级:存量 24 条边原样保留,remark 一次填成空串(不校验历史数据)
#[test]
fn upgrade_from_v22_keeps_edges_and_defaults_remark_empty() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v22(&c);
    add_tag(&c, 613, "地点轴/国籍");
    for id in 100..124 {
        add_tag(&c, id, &format!("作者{id}"));
        c.execute(
            "INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'tag', 613)",
            rusqlite::params![id],
        )
        .unwrap();
    }

    run(&c).unwrap();

    assert!(col_exists(&c, "tag_links", "remark"));
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='tag'"), 24);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='tag' AND remark <> ''"),
        0,
        "历史边的属性名为空(显示时回退只给目标名)"
    );
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='tag' AND remark IS NULL"),
        0,
        "列 NOT NULL DEFAULT '':不允许 NULL"
    );
}

/// ③ 023 重放幂等:钩子与 SQL 各跑两次都不报 duplicate column,列仍只一列
#[test]
fn replay_of_023_is_idempotent() {
    let c = Connection::open_in_memory().unwrap();
    run(&c).unwrap();
    migration_hooks::ensure_link_remark_column(&c).unwrap();
    migration_hooks::ensure_link_remark_column(&c).unwrap();
    apply(&c, MIGRATIONS[22], 23).unwrap();
    apply(&c, MIGRATIONS[22], 23).unwrap();

    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 23);
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('tag_links') WHERE name='remark'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1, "重放不得加出第二列");
}
