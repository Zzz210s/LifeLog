//! 数据目录迁移的六条用例(spec 2026-09-15 第 3.1 节 + task brief):
//! ① 新库存在 -> 什么都不做(含旧库也在,验证旧库未被覆盖)
//! ② 旧库存在 -> 复制成功且内容一致(含只存在于 -wal 里、未 checkpoint 的数据)
//! ③ 两边都没有 -> 什么都不做
//! ④ 目标目录不可用 -> 返回 Err 且不创建半成品
//! ⑤ 历史备份 `lifelog.db.bak-*` 一并复制(不匹配的文件不复制)
//! ⑥ 途中某个附属文件复制失败 -> 新目录里没有主库(完成标记),再次调用重新尝试
//!
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
fn existing_new_db_is_left_untouched_even_when_old_db_exists() {
    let root = temp_root("idempotent");
    let old = root.join("app.lifelog");
    let new = root.join("com.lifelog.app");
    fs::create_dir_all(&old).unwrap();
    fs::create_dir_all(&new).unwrap();
    seed_db(&old.join(DB_FILE), "旧库内容");
    seed_db(&new.join(DB_FILE), "新库内容");

    let outcome = migrate(&new, &old).unwrap();

    assert_eq!(outcome, Outcome::AlreadyPresent);
    assert_eq!(bodies(&new.join(DB_FILE)), vec!["新库内容".to_string()]);
    assert_eq!(bodies(&old.join(DB_FILE)), vec!["旧库内容".to_string()]);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn old_db_is_copied_with_uncheckpointed_wal_data() {
    let root = temp_root("copy");
    let old = root.join("app.lifelog");
    let new = root.join("com.lifelog.app");
    fs::create_dir_all(&old).unwrap();

    let conn = Connection::open(old.join(DB_FILE)).unwrap();
    conn.pragma_update(None, "journal_mode", "WAL").unwrap();
    conn.execute_batch("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT);")
        .unwrap();
    conn.execute("INSERT INTO notes(body) VALUES ('买牛奶')", [])
        .unwrap();
    conn.execute("INSERT INTO notes(body) VALUES ('看电影')", [])
        .unwrap();
    // 连接保持打开:两行仍在 -wal 里没有 checkpoint
    let wal = old.join("lifelog.db-wal");
    assert!(
        wal.is_file() && fs::metadata(&wal).unwrap().len() > 0,
        "前置条件失败:-wal 应存在且非空"
    );

    let outcome = migrate(&new, &old).unwrap();

    assert_eq!(outcome, Outcome::Migrated { files: 1 });
    drop(conn);
    assert_eq!(
        bodies(&new.join(DB_FILE)),
        vec!["买牛奶".to_string(), "看电影".to_string()],
        "复制出来的新库必须含 -wal 里未 checkpoint 的数据"
    );
    assert!(old.join(DB_FILE).is_file(), "旧库必须保留:只复制不移动");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn fresh_install_does_nothing_and_creates_nothing() {
    let root = temp_root("fresh");
    let old = root.join("app.lifelog");
    let new = root.join("com.lifelog.app");

    let outcome = migrate(&new, &old).unwrap();

    assert_eq!(outcome, Outcome::Fresh);
    assert!(!new.exists(), "全新安装不应预先建新目录");
    assert!(!old.exists(), "旧目录本就该不存在");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn unusable_target_returns_err_without_partial_files() {
    let root = temp_root("bad-target");
    let old = root.join("app.lifelog");
    fs::create_dir_all(&old).unwrap();
    seed_db(&old.join(DB_FILE), "旧库内容");
    // 用普通文件占住目标路径:create_dir_all 必然失败
    let new = root.join("com.lifelog.app");
    fs::write(&new, "占位文件").unwrap();

    let err = migrate(&new, &old).unwrap_err();

    assert!(err.contains("创建新数据目录失败"), "错误应说明原因:{err}");
    assert!(new.is_file(), "占位文件不应被破坏");
    assert_eq!(bodies(&old.join(DB_FILE)), vec!["旧库内容".to_string()]);
    let leftovers: Vec<_> = fs::read_dir(&root)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.contains(".part"))
        .collect();
    assert!(leftovers.is_empty(), "不应留下任何 .part 半成品:{leftovers:?}");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn backups_are_copied_and_other_files_are_not() {
    let root = temp_root("backups");
    let old = root.join("app.lifelog");
    let new = root.join("com.lifelog.app");
    fs::create_dir_all(&old).unwrap();
    seed_db(&old.join(DB_FILE), "旧库内容");
    fs::write(old.join("lifelog.db.bak-6-20260913T120334"), b"backup-6").unwrap();
    fs::write(old.join("lifelog.db.bak-p1-20260915"), b"backup-p1").unwrap();
    fs::write(old.join("notes.txt"), "无关文件".as_bytes()).unwrap();

    let outcome = migrate(&new, &old).unwrap();

    assert_eq!(outcome, Outcome::Migrated { files: 3 });
    assert_eq!(fs::read(new.join("lifelog.db.bak-6-20260913T120334")).unwrap(), b"backup-6");
    assert_eq!(fs::read(new.join("lifelog.db.bak-p1-20260915")).unwrap(), b"backup-p1");
    assert_eq!(bodies(&new.join(DB_FILE)), vec!["旧库内容".to_string()]);
    assert!(!new.join("notes.txt").exists(), "不匹配前缀的文件不该复制");
    let _ = fs::remove_dir_all(&root);
}

/// 完成标记语义:附属文件先复制、主库最后复制。中途失败时新目录里**没有**主库,
/// 下次调用会重新尝试,而不是因为看见主库就误判 AlreadyPresent 而放弃。
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
