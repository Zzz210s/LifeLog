//! 老 `note_links` 表(迁移 019)与外键用例:阶段 4 起它是过渡镜像(写路径双写),
//! 到迁移 027 下架。自 note_links_tests.rs 分出以守 200 行上限。
use crate::db::migrate;
use rusqlite::Connection;

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
    assert_eq!(count(&c, table), 1, "迁移 019 应建出 note_links 表(过渡镜像)");
    let idx = "SELECT COUNT(*) FROM sqlite_master WHERE type='index' \
               AND name IN ('note_links_source','note_links_target')";
    assert_eq!(count(&c, idx), 2, "两个索引都要在(出链/入链方向各一)");
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, migrate::latest_version(), "迁移序列走完应到最新版本");
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
    assert_eq!(v, migrate::latest_version());
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
    assert_eq!(t, None, "删目标笔记后老镜像退回未解析,而不是整行消失");
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
