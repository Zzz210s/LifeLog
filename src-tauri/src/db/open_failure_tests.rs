//! `open()` 的失败可见化读数:迁移失败不得 panic,必须给出中文原因与已生成的备份路径,
//! 且失败迁移整批回滚、库内容不变;备份失败只降级为警告、不阻断迁移。
use super::{open, open_with, BackupFn, OpenFailure};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use super::migrate::latest_version;

/// 006 之前的全部迁移(与 migrate::MIGRATIONS 前 5 项一致),用于造一个停在 v5 的库
const UPTO_V5: &[&str] = &[
    include_str!("migrations/001_init.sql"),
    include_str!("migrations/002_diary.sql"),
    include_str!("migrations/003_stream.sql"),
    include_str!("migrations/004_stream_backfill.sql"),
    include_str!("migrations/005_rename_keys.sql"),
];

fn fixture_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("lifelog-openfail-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// 造一个停在 user_version=5 的真库(有一条笔记与一个旧标签);`conflict` 为真时
/// 预置一个与 006 首条语句(`CREATE TABLE tags_new`)同名的表,让 006 必然失败。
fn v5_db(path: &Path, conflict: bool) {
    let conn = Connection::open(path).unwrap();
    for sql in UPTO_V5 {
        conn.execute_batch(sql).unwrap();
    }
    conn.pragma_update(None, "user_version", 5i64).unwrap();
    conn.execute_batch(
        "INSERT INTO notes(content) VALUES('买牛奶');
         INSERT INTO tags(name) VALUES('原有标签');",
    )
    .unwrap();
    if conflict {
        conn.execute_batch("CREATE TABLE tags_new(x INTEGER);").unwrap();
    }
}

fn scalar(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn migration_failure_reports_reason_and_backup_without_modifying_db() {
    let dir = fixture_dir("rollback");
    let path = dir.join("lifelog.db");
    v5_db(&path, true);

    let failure: OpenFailure = open(&path)
        .err()
        .expect("006 冲突时 open 必须返回 Err 而不是 panic");

    assert!(
        failure.reason.contains("数据库迁移失败"),
        "原因应是中文迁移失败说明: {}",
        failure.reason
    );
    assert!(
        failure.reason.contains("tags_new"),
        "原因应带底层 SQLite 报错: {}",
        failure.reason
    );

    let backup = failure
        .backup
        .expect("迁移失败时必须带出失败前已生成的备份路径");
    assert!(backup.exists(), "备份文件必须真实存在: {backup:?}");

    // 库未被修改:版本停在 5,数据与冲突表原样,006 新增的 path 列没进来
    let conn = Connection::open(&path).unwrap();
    assert_eq!(scalar(&conn, "PRAGMA user_version"), 5);
    assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM notes"), 1);
    assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM tags"), 1);
    assert_eq!(
        scalar(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE name='tags_new'"
        ),
        1
    );
    assert_eq!(
        scalar(
            &conn,
            "SELECT COUNT(*) FROM pragma_table_info('tags') WHERE name='path'"
        ),
        0
    );

    // 备份是失败前的一致快照(同为 v5)
    let bconn = Connection::open(&backup).unwrap();
    assert_eq!(scalar(&bconn, "PRAGMA user_version"), 5);
}

#[test]
fn migration_success_reports_backup_path_and_no_warning() {
    let dir = fixture_dir("ok");
    let path = dir.join("lifelog.db");
    v5_db(&path, false);

    let report = open(&path).unwrap();

    let backup = report.backup.expect("有迁移要跑时必须生成备份");
    assert!(backup.exists());
    assert!(report.backup_warning.is_none(), "备份成功不应有警告");
    assert_eq!(scalar(&report.conn, "PRAGMA user_version"), latest_version());
    assert_eq!(
        scalar(
            &report.conn,
            "SELECT COUNT(*) FROM pragma_table_info('tags') WHERE name='path'"
        ),
        1,
        "006 应已生效"
    );
}

#[test]
fn backup_failure_becomes_warning_and_migration_still_runs() {
    let dir = fixture_dir("warn");
    let path = dir.join("lifelog.db");
    v5_db(&path, false);

    let failing: &BackupFn = &|_conn, _path, _v| Err("磁盘已满(测试夹具)".to_string());
    let report = open_with(&path, failing).unwrap();

    assert!(report.backup.is_none(), "备份失败时不应报告备份路径");
    assert_eq!(
        report.backup_warning.as_deref(),
        Some("磁盘已满(测试夹具)"),
        "备份失败原因必须传给上层弹警告"
    );
    // 备份失败不影响迁移结果
    assert_eq!(scalar(&report.conn, "PRAGMA user_version"), latest_version());
    assert_eq!(scalar(&report.conn, "SELECT COUNT(*) FROM notes"), 1);
}
