//! 数据目录迁移「复制什么」的用例:连 `-wal` 一起复制、`-journal` 防御性复制、历史备份。
//!
//! 与 [`super::data_dir_migration_tests`] 的「流程」用例互补(WAL 合并成功、幂等、失败重试等)。
//! 全部用临时目录,绝不触碰真实数据。

use super::data_dir_migration::{migrate, Outcome, DB_FILE};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static SEQ: AtomicU32 = AtomicU32::new(0);

fn temp_root(tag: &str) -> PathBuf {
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let dir =
        std::env::temp_dir().join(format!("lifelog-migrate-{tag}-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// 读回单列文本
fn bodies(path: &Path) -> Vec<String> {
    let conn = Connection::open(path).unwrap();
    let mut stmt = conn.prepare("SELECT body FROM notes ORDER BY id").unwrap();
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

/// 旧库 `-wal` 非空、且有另一个连接持有读事务:TRUNCATE checkpoint 必然拿不到独占,
/// 走「连 -wal 一起复制」的降级分支,复制出的新库必须仍能读到 WAL 里的数据。
#[test]
fn busy_old_db_copies_wal_alongside_main_db() {
    let root = temp_root("busy-wal");
    let old = root.join("app.lifelog");
    let new = root.join("com.lifelog.app");
    fs::create_dir_all(&old).unwrap();

    let writer = Connection::open(old.join(DB_FILE)).unwrap();
    writer.pragma_update(None, "journal_mode", "WAL").unwrap();
    writer
        .execute_batch("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT);")
        .unwrap();
    writer
        .execute("INSERT INTO notes(body) VALUES ('买牛奶')", [])
        .unwrap();
    // 另开一个连接并保持读事务:让 checkpoint 无法独占
    let reader = Connection::open(old.join(DB_FILE)).unwrap();
    reader.execute_batch("BEGIN; SELECT count(*) FROM notes;").unwrap();
    let wal = old.join("lifelog.db-wal");
    assert!(
        wal.is_file() && fs::metadata(&wal).unwrap().len() > 0,
        "前置条件失败:-wal 应存在且非空"
    );

    let outcome = migrate(&new, &old).unwrap();

    assert_eq!(
        outcome,
        Outcome::Migrated { files: 2 },
        "checkpoint 失败时必须连 -wal 一起复制(计数含 -wal)"
    );
    assert!(new.join("lifelog.db-wal").is_file(), "-wal 应被复制到新目录");
    drop(reader);
    drop(writer);
    assert_eq!(
        bodies(&new.join(DB_FILE)),
        vec!["买牛奶".to_string()],
        "复制出的新库必须能读到 WAL 里未 checkpoint 的数据"
    );
    let _ = fs::remove_dir_all(&root);
}

/// 旧库残留 `-journal` 时一并复制(防御性:缺少它就是缺一段未落盘的数据)
#[test]
fn stale_journal_is_copied_along_with_main_db() {
    let root = temp_root("journal");
    let old = root.join("app.lifelog");
    let new = root.join("com.lifelog.app");
    fs::create_dir_all(&old).unwrap();
    let conn = Connection::open(old.join(DB_FILE)).unwrap();
    conn.execute_batch("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT);")
        .unwrap();
    conn.execute("INSERT INTO notes(body) VALUES ('买牛奶')", [])
        .unwrap();
    drop(conn);
    fs::write(old.join("lifelog.db-journal"), b"leftover-journal").unwrap();

    let outcome = migrate(&new, &old).unwrap();

    assert_eq!(outcome, Outcome::Migrated { files: 2 }, "计数应含 -journal");
    assert_eq!(
        fs::read(new.join("lifelog.db-journal")).unwrap(),
        b"leftover-journal"
    );
    assert_eq!(bodies(&new.join(DB_FILE)), vec!["买牛奶".to_string()]);
    let _ = fs::remove_dir_all(&root);
}
