//! 数据目录迁移的失败重试与过期附属文件清理(migrate() 级回归):
//! ① 附属文件先复制、主库最后复制 -> 中途失败时新目录没有主库,下次调用重新尝试
//! ② 新目录预置过期的 `lifelog.db-wal`/`-shm`,而旧库已自足(无 `-wal`)
//!    -> migrate() 必须清掉它们再放主库,否则 SQLite 打开新库时会重放过期页映像。
//! 用例走 `migrate()` 入口(不是直接调 clear_stale_sidecars),调用点被删就会 RED。
use super::data_dir_migration::{migrate, Outcome, DB_FILE};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static SEQ: AtomicU32 = AtomicU32::new(0);

fn temp_root(tag: &str) -> PathBuf {
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let dir =
        std::env::temp_dir().join(format!("lifelog-retry-{tag}-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// 造一个带一行数据、已 checkpoint 的普通数据库
fn seed_db(path: &Path, body: &str) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT);")
        .unwrap();
    conn.execute("INSERT INTO notes(body) VALUES (?1)", [body])
        .unwrap();
}

/// 读回单列文本
fn bodies(path: &Path) -> Vec<String> {
    let conn = Connection::open(path).unwrap();
    let mut stmt = conn.prepare("SELECT body FROM notes ORDER BY id").unwrap();
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

#[test]
fn failed_later_copy_leaves_no_main_db_and_migration_retries() {
    let root = temp_root("partial");
    let old = root.join("app.lifelog");
    let new = root.join("com.lifelog.app");
    fs::create_dir_all(&old).unwrap();
    seed_db(&old.join(DB_FILE), "旧库内容");
    let bak = "lifelog.db.bak-6-20260913T120334";
    fs::write(old.join(bak), b"backup-6").unwrap();
    fs::create_dir_all(&new).unwrap();
    // 用同名目录占住备份的 .part 路径:复制必然失败,且失败发生在主库之前
    fs::create_dir_all(new.join(format!("{bak}.part"))).unwrap();

    let err = migrate(&new, &old).unwrap_err();
    assert!(err.contains("复制失败"), "错误应说明复制失败:{err}");
    assert!(
        !new.join(DB_FILE).exists(),
        "主库最后复制:途中失败时新目录不该有 lifelog.db"
    );

    // 关键:再调一次必须重新尝试复制,而不是误判 AlreadyPresent 后放过
    let err2 = migrate(&new, &old).unwrap_err();
    assert!(err2.contains("复制失败"), "再次调用应重新尝试:{err2}");

    // 清掉挡路的目录后,迁移终于能完成(主库此时才出现)
    fs::remove_dir_all(new.join(format!("{bak}.part"))).unwrap();
    assert_eq!(migrate(&new, &old).unwrap(), Outcome::Migrated { files: 2 });
    assert!(new.join(DB_FILE).is_file(), "重试成功后才出现主库");
    assert_eq!(bodies(&new.join(DB_FILE)), vec!["旧库内容".to_string()]);
    let _ = fs::remove_dir_all(&root);
}

/// 过期附属文件:旧库没有 `-wal`(已自足,不会被复制),新目录里那份过期 `-wal`/`-shm`
/// 必须先清掉;否则它与新复制进来的主库并存,SQLite 打开时可能重放其中较早的页映像。
#[test]
fn stale_sidecars_in_new_dir_are_cleared_before_main_db_lands() {
    let root = temp_root("stale");
    let old = root.join("app.lifelog");
    let new = root.join("com.lifelog.app");
    fs::create_dir_all(&old).unwrap();
    fs::create_dir_all(&new).unwrap();
    seed_db(&old.join(DB_FILE), "旧库内容");
    assert!(!old.join("lifelog.db-wal").exists(), "前置条件:旧库已 checkpoint,无 -wal");
    // 新目录里留下上一次尝试的过期附属文件
    fs::write(new.join("lifelog.db-wal"), "过期的页映像".as_bytes()).unwrap();
    fs::write(new.join("lifelog.db-shm"), "过期的共享内存".as_bytes()).unwrap();

    let outcome = migrate(&new, &old).unwrap();

    assert_eq!(outcome, Outcome::Migrated { files: 1 }, "只复制主库");
    assert!(!new.join("lifelog.db-wal").exists(), "过期 -wal 必须清掉");
    assert!(!new.join("lifelog.db-shm").exists(), "过期 -shm 必须清掉");
    assert_eq!(bodies(&new.join(DB_FILE)), vec!["旧库内容".to_string()]);
    let _ = fs::remove_dir_all(&root);
}
