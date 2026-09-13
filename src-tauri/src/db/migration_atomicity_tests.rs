//! 迁移事务原子性测试:单条迁移的 SQL 与 user_version 必须同批提交,失败整库回滚。
use super::{apply, run, MIGRATIONS};

fn count_of(conn: &rusqlite::Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn failed_migration_rolls_back_whole_database() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    run(&conn).unwrap();
    conn.execute_batch("INSERT INTO tags(name, path, depth) VALUES('原有', '原有', 1);")
        .unwrap();
    let before = count_of(&conn, "PRAGMA user_version");
    let tags_before = count_of(&conn, "SELECT COUNT(*) FROM tags");

    // 夹具:同批次前半建表成功、后半表名错误,整批必须回滚
    let err = apply(
        &conn,
        "CREATE TABLE rollback_probe(x INTEGER);\nINSERT INTO table_does_not_exist VALUES(1);",
        before + 1,
    );
    assert!(err.is_err(), "夹具迁移必须报错");

    assert_eq!(
        count_of(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE name='rollback_probe'"
        ),
        0,
        "失败迁移不得留下半成品表"
    );
    assert_eq!(
        count_of(&conn, "PRAGMA user_version"),
        before,
        "失败迁移不得推进版本号"
    );
    assert_eq!(count_of(&conn, "SELECT COUNT(*) FROM tags"), tags_before);
    assert_eq!(MIGRATIONS.len() as i64, before, "前置 run 应已到最新版本");
}
