//! 007 自建视图迁移的历史回归:①007 本体建表与索引齐备 ②幂等(版本闸门 + SQL 本体可重放)
//! ③迁移前生成备份(走 db::open 的完整链路) ④旧库数据(笔记/标签/链接)不变。
//! 注:saved_views 表已在 014 被删(S6),故本文件只应用 007 本体/停在 007 的版本上,
//! "最新库里该表不存在"与 011 的日期清理断言见 saved_views_removal_tests.rs。
use super::{apply, latest_version, MIGRATIONS};
use crate::db::open;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// 007 在迁移序列中的位次(1 起);旧库 = 应用到 007 之前(user_version 停在 6)
const V_007: usize = 7;

/// 升级前旧库:应用到 007 之前为止,外键开启(与真实运行时一致)
fn old_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    for sql in &MIGRATIONS[..(V_007 - 1)] {
        conn.execute_batch(sql).unwrap();
    }
    conn.pragma_update(None, "user_version", (V_007 - 1) as i64)
        .unwrap();
    conn
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn text(conn: &Connection, sql: &str) -> String {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 独立临时目录(每个测试一个 tag,避免并行互踩)
fn fixture_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("lifelog-v007-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// 造一个停在 v6 的真库文件(带一条笔记与一个标签)
fn v6_file(path: &Path) {
    let conn = Connection::open(path).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    for sql in &MIGRATIONS[..(V_007 - 1)] {
        conn.execute_batch(sql).unwrap();
    }
    conn.pragma_update(None, "user_version", (V_007 - 1) as i64).unwrap();
    conn.execute_batch(
        "INSERT INTO notes(content) VALUES('迁移前笔记');
         INSERT INTO tags(name, parent_id, path, depth) VALUES('工作', NULL, '工作', 1);
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(1, 'note', 1);",
    )
    .unwrap();
}

/// ① 007 本体:表五列齐备、排序索引存在、版本推进到 7
#[test]
fn migration_007_creates_table_and_bumps_version() {
    let conn = old_db();
    apply(&conn, MIGRATIONS[V_007 - 1], V_007 as i64).unwrap();
    assert_eq!(count(&conn, "PRAGMA user_version"), 7);
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='saved_views'"),
        1
    );
    for col in ["id", "title", "conditions", "sort_order", "created_at"] {
        assert_eq!(
            count(&conn, &format!("SELECT COUNT(*) FROM pragma_table_info('saved_views') WHERE name='{col}'")),
            1,
            "缺少列: {col}"
        );
    }
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_saved_views_sort'"),
        1
    );
}

/// ② 幂等:007 的 SQL 本体可重放(IF NOT EXISTS);版本闸门由 migrate::run 负责
#[test]
fn migration_007_is_idempotent() {
    let conn = old_db();
    apply(&conn, MIGRATIONS[V_007 - 1], V_007 as i64).unwrap();
    conn.execute_batch(
        "INSERT INTO saved_views(title, conditions, sort_order, created_at)
         VALUES('存量视图', '{}', 3, '2026-09-13 08:00:00');",
    )
    .unwrap();
    let snapshot = |c: &Connection| {
        (
            count(c, "PRAGMA user_version"),
            count(c, "SELECT COUNT(*) FROM saved_views"),
            text(c, "SELECT conditions FROM saved_views WHERE id = 1"),
        )
    };
    let first = snapshot(&conn);

    let sql = MIGRATIONS[V_007 - 1];
    conn.execute_batch(sql).unwrap(); // SQL 本体重放
    conn.execute_batch(sql).unwrap();
    assert_eq!(snapshot(&conn), first, "重放不得清空或重复建表");
}

/// ③ 迁移前生成备份:走 db::open 完整链路,备份是迁移前(v6)的含数据快照
#[test]
fn migration_007_backs_up_before_running() {
    let dir = fixture_dir("backup");
    let path = dir.join("lifelog.db");
    v6_file(&path);

    let report = open(&path).unwrap();

    let backup = report.backup.expect("有迁移要跑时必须先生成备份");
    assert!(backup.exists(), "备份文件必须真实存在: {backup:?}");
    let bconn = Connection::open(&backup).unwrap();
    assert_eq!(count(&bconn, "PRAGMA user_version"), 6, "备份应是迁移前版本");
    assert_eq!(count(&bconn, "SELECT COUNT(*) FROM notes"), 1, "备份应含迁移前数据");
    assert_eq!(
        count(&bconn, "SELECT COUNT(*) FROM sqlite_master WHERE name='saved_views'"),
        0,
        "备份不应已含新表"
    );
    assert_eq!(count(&report.conn, "PRAGMA user_version"), latest_version(), "主库应已升级");
    assert!(report.backup_warning.is_none());
}

/// ④ 旧库数据不变:笔记/标签/链接行数与内容快照在迁移前后一致
#[test]
fn migration_007_keeps_existing_data_untouched() {
    let conn = old_db();
    conn.execute_batch(
        "INSERT INTO notes(content) VALUES('旧笔记一'), ('旧笔记二');
         INSERT INTO tags(name, parent_id, path, depth) VALUES('工作', NULL, '工作', 1);
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(1, 'note', 1);",
    )
    .unwrap();
    let snapshot = |c: &Connection| {
        (
            count(c, "SELECT COUNT(*) FROM notes"),
            count(c, "SELECT COUNT(*) FROM tags"),
            count(c, "SELECT COUNT(*) FROM tag_links"),
            count(c, "SELECT COUNT(*) FROM notes_fts"),
            text(c, "SELECT content FROM notes WHERE id = 1"),
            text(c, "SELECT path FROM tags WHERE id = 1"),
        )
    };
    let before = snapshot(&conn);

    // 只应用 007 本体:本用例关注 007 的 SQL 是否动既有数据,
    // 后续迁移(008 时间标签回填)另有专门用例(见 time_tag_migration_tests.rs)
    apply(&conn, MIGRATIONS[V_007 - 1], V_007 as i64).unwrap();

    assert_eq!(snapshot(&conn), before, "007 不得动既有笔记/标签/链接数据");
    assert_eq!(count(&conn, "PRAGMA user_version"), 7);
    assert_eq!(count(&conn, "PRAGMA foreign_keys"), 1, "迁移后外键必须保持 ON");
}
