//! 迁移钩子的日志读数(自 migrate_tests.rs 拆出以守单文件 200 行)。
//! 008 的钩子日志只报"确实因此拿不到时间标签"的笔记 —— created_at 无法解析但已有时间标签
//! 的笔记不在此列。钩子读老表,故在 v7 库上直接验。
use super::*;
use crate::db::migration_hooks::backfill_skips;
use rusqlite::Connection;

/// 把库停在 `n` 版(手工重放前 n 条迁移)
fn at_version(n: usize) -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(n) {
        apply(&conn, sql, (i + 1) as i64).unwrap();
    }
    conn
}

/// 造一条原始笔记(不经过标签解析,直接给 created_at)
fn insert_note(conn: &Connection, content: &str, created_at: &str) -> i64 {
    conn.execute(
        "INSERT INTO notes(content, created_at) VALUES(?1, ?2)",
        rusqlite::params![content, created_at],
    )
    .unwrap();
    conn.last_insert_rowid()
}

#[test]
fn backfill_hook_reports_only_notes_missing_time_tags() {
    let conn = at_version(7);
    let bad = insert_note(&conn, "坏时间", "坏的");
    let tagged = insert_note(&conn, "已有时间标签", "坏的");
    let ok = insert_note(&conn, "正常时间", "2026-03-04 10:00:00");
    conn.execute(
        "INSERT INTO tags(name, path, depth) VALUES('2020/05/05', '时间排序/2020/05/05', 4)",
        [],
    )
    .unwrap();
    let tag_id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'note', ?2)",
        rusqlite::params![tag_id, tagged],
    )
    .unwrap();

    let skips = backfill_skips(&conn).unwrap();

    assert_eq!(skips, vec![(bad, "坏的".to_string())], "只报缺时间标签的笔记");
    assert!(!skips.iter().any(|(id, _)| *id == tagged || *id == ok));
}
