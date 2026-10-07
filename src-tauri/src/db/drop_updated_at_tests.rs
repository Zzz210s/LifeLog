//! 迁移 012(spec 2026-09-17 S3):删除 notes.updated_at 列。
//! 阶段 4(027)后 `notes` 整表下架,本文件改对 `entities` 断言(实体从老笔记投影而来):
//! ① 新库跑到最新版本后 `entities` 不再有 `updated_at`,created_at 仍在
//! ② 旧库(仍有 updated_at 且有数据)升级:正文/时间逐字节不动,实体行与索引行都在
//! ③ 删列后触发器仍完好:新插入建索引行、更新重写索引
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

/// `entities` 上是否还有该列(过渡期列与 `updated_at` 都不该存在)
fn has_column(conn: &Connection, column: &str) -> bool {
    count(
        conn,
        &format!("SELECT COUNT(*) FROM pragma_table_info('entities') WHERE name='{column}'"),
    ) > 0
}

#[test]
fn fresh_db_has_no_updated_at_but_keeps_created_at() {
    let conn = db();
    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
    assert!(!has_column(&conn, "updated_at"), "实体上不应有 updated_at");
    assert!(has_column(&conn, "created_at"), "created_at 必须保留");
    // 027 已把老 notes 表整个下架
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name='notes'"), 0);
}

#[test]
fn upgrading_legacy_db_drops_column_without_touching_data() {
    let c = db_at_011();
    assert!(
        count(&c, "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='updated_at'") > 0,
        "前置:旧库仍有 updated_at"
    );
    run(&c).unwrap();

    assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
    // 数据一字不动:笔记实体、索引行都还在,正文可读
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE kind='note'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities_fts WHERE content <> ''"), 1);
    let content: String = c
        .query_row("SELECT content FROM entities WHERE kind='note'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(content, "历史 #甲"); // 裸 SQL 插入不剥离标签,正文逐字节不动
}

#[test]
fn triggers_survive_the_drop_column() {
    let mut c = db();
    // entities_ai 触发器仍建索引行
    let n = create_plain(&mut c, "新笔记 #乙").unwrap();
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM entities_fts WHERE rowid={}", n.id)),
        1
    );
    // entities_au 触发器仍按当前链接重写索引
    update(&mut c, n.id, "改后 #丙").unwrap().unwrap();
    let tags: String = c
        .query_row("SELECT tag_paths FROM entities_fts WHERE rowid=?1", [n.id], |r| r.get(0))
        .unwrap();
    assert!(tags.contains("丙") && !tags.contains("乙"), "FTS 未随更新收敛: {tags}");
}
