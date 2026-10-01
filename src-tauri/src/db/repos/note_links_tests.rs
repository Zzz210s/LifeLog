//! 迁移 019(`note_links` 表与两个索引)的用例。
//! 只测迁移本身;仓库层的写入/读取语义归 Task 3。
use crate::db::migrate;
use rusqlite::Connection;

/// 内存库 + 跑完全部迁移。**显式开外键**:`ON DELETE SET NULL` / `CASCADE` 依赖它,
/// 而 `migrate::run` 不负责开(生产路径由 `db::open` 开,见 src-tauri/src/db/mod.rs)。
fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn migration_creates_table_and_indexes() {
    let c = db();
    let table = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='note_links'";
    assert_eq!(count(&c, table), 1, "迁移 019 应建出 note_links 表");
    let idx = "SELECT COUNT(*) FROM sqlite_master WHERE type='index' \
               AND name IN ('note_links_source','note_links_target')";
    assert_eq!(count(&c, idx), 2, "两个索引都要在(出链/入链方向各一)");
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 19, "迁移序列走完应是 19");
}

#[test]
fn target_fk_sets_null_on_delete() {
    let c = db();
    c.execute_batch(
        "INSERT INTO notes(id, content, created_at) VALUES (1,'源','2026-01-01'),(2,'目标','2026-01-02');
         INSERT INTO note_links(source_id, target_id, raw_title, created_at) VALUES (1,2,'目标','2026-01-03');",
    )
    .unwrap();
    c.execute("DELETE FROM notes WHERE id = 2", []).unwrap();
    let t: Option<i64> = c.query_row("SELECT target_id FROM note_links", [], |r| r.get(0)).unwrap();
    assert_eq!(t, None, "删目标笔记后链接退回未解析,而不是整行消失");
}

#[test]
fn source_fk_cascades_on_delete() {
    let c = db();
    c.execute_batch(
        "INSERT INTO notes(id, content, created_at) VALUES (1,'源','2026-01-01'),(2,'目标','2026-01-02');
         INSERT INTO note_links(source_id, target_id, raw_title, created_at) VALUES (1,2,'目标','2026-01-03');",
    )
    .unwrap();
    c.execute("DELETE FROM notes WHERE id = 1", []).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM note_links"), 0, "源没了链接无意义,整行级联删");
}

#[test]
fn migration_is_idempotent() {
    let c = db();
    // 同一连接重放:已是最新版本,run 应短路且不报错、版本号不变、表不重复建
    migrate::run(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='note_links'"), 1);
    // 更硬的幂等:把版本退回 18 再跑,让 019 的 SQL 真的重放一遍
    // (与 done_doing/drop_updated_at 的幂等用例同法;IF NOT EXISTS 一旦被删,这里报 table already exists)
    c.pragma_update(None, "user_version", 18).unwrap();
    migrate::run(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='note_links'"), 1);
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 19);
}
