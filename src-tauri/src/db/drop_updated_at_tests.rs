//! 迁移 012(spec 2026-09-17 S3):删除 notes.updated_at 列。
//! ① 新库跑到最新版本后 notes 不再有该列,created_at 仍在
//! ② 旧库(仍有 updated_at 且有数据)升级:只删列,笔记/标签/链接/FTS 行数不变
//! ③ 幂等:把 user_version 退回 11 再跑一次 run() 不报错(守卫跳过 DROP COLUMN)
//! ④ 删列后触发器仍完好:新插入建 FTS 行、更新重写 FTS
use super::*;
use crate::db::repos::notes::{create_plain, update};

/// 新库:跑到最新版本
fn db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    run(&conn).unwrap();
    conn
}

/// 到 011 为止的旧库(user_version 停在 11),仍然有 updated_at 列
fn db_at_011() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(DROP_UPDATED_AT_VERSION as usize - 1) {
        conn.execute_batch(sql).unwrap();
        conn.pragma_update(None, "user_version", (i + 1) as i64).unwrap();
    }
    // 旧库里的历史笔记:直接写 updated_at(升级前该列还在)
    conn.execute(
        "INSERT INTO notes(content, created_at, updated_at) VALUES('历史 #甲', '2026-03-04 10:00:00', '2026-03-05 11:00:00')",
        [],
    )
    .unwrap();
    conn
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn has_updated_at(conn: &Connection) -> bool {
    let n = count(
        conn,
        "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='updated_at'",
    );
    n > 0
}

#[test]
fn fresh_db_has_no_updated_at_but_keeps_created_at() {
    let conn = db();
    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
    assert!(!has_updated_at(&conn), "012 后 notes 不应再有 updated_at");
    let created = count(
        &conn,
        "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='created_at'",
    );
    assert_eq!(created, 1, "created_at 必须保留");
}

#[test]
fn upgrading_legacy_db_drops_column_without_touching_data() {
    let mut c = db_at_011();
    assert!(has_updated_at(&c), "前置:旧库仍有 updated_at");
    run(&mut c).unwrap();

    assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
    assert!(!has_updated_at(&c));
    // 数据一字不动:笔记行、FTS 行都还在,正文可读
    assert_eq!(count(&c, "SELECT COUNT(*) FROM notes"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM notes_fts"), 1);
    let content: String = c.query_row("SELECT content FROM notes", [], |r| r.get(0)).unwrap();
    assert_eq!(content, "历史 #甲"); // 裸 SQL 插入不剥离标签,正文逐字节不动
}

#[test]
fn rerunning_012_is_a_noop() {
    let mut c = db();
    // 直接把版本退回 11,模拟"同一迁移再跑一次"(真实 run() 靠 user_version 不会重跑)
    c.pragma_update(None, "user_version", DROP_UPDATED_AT_VERSION - 1)
        .unwrap();
    run(&mut c).unwrap();
    assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
    assert!(!has_updated_at(&c));
}

#[test]
fn triggers_survive_the_drop_column() {
    let mut c = db();
    // notes_ai 触发器仍建 FTS 行
    let n = create_plain(&mut c, "新笔记 #乙").unwrap();
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM notes_fts WHERE rowid={}", n.id)), 1);
    // notes_au 触发器仍按当前链接重写 FTS
    update(&mut c, n.id, "改后 #丙").unwrap().unwrap();
    let tags: String = c
        .query_row("SELECT tags FROM notes_fts WHERE rowid=?1", [n.id], |r| r.get(0))
        .unwrap();
    assert!(tags.contains("丙") && !tags.contains("乙"), "FTS tags 未随更新收敛: {tags}");
}
