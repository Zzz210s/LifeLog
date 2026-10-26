//! 首次迁移(旧单库 → `libraries/richang/`)的用例:用临时目录造一个真 SQLite 文件。
use super::*;
use crate::db::library;

fn tmp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("lifelog-mig-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// 造一个"旧单库":真的 SQLite 文件,带一张表与一行数据
fn make_legacy(dir: &std::path::Path) -> std::path::PathBuf {
    let p = dir.join(crate::db::data_dir_migration::DB_FILE);
    let conn = rusqlite::Connection::open(&p).unwrap();
    conn.execute("CREATE TABLE probe(x TEXT)", []).unwrap();
    conn.execute("INSERT INTO probe VALUES('日常数据')", []).unwrap();
    drop(conn);
    p
}

#[test]
fn migrates_legacy_single_db_into_libraries_dir_and_names_it() {
    let dir = tmp_dir("happy");
    make_legacy(&dir);
    let out = ensure(&dir).unwrap();
    assert!(out.migrated);
    assert_eq!(out.registry.current, library::LEGACY_LIB_ID);
    assert_eq!(out.registry.libraries[0].name, "日常");
    // 库文件落到新位置,旧位置不再有
    let new_db = dir
        .join(&out.registry.libraries[0].dir)
        .join(library::LIB_DB_FILE);
    assert!(new_db.exists(), "库文件应搬进 libraries/richang/");
    assert!(!dir.join(crate::db::data_dir_migration::DB_FILE).exists());
    // 数据还在
    let conn = rusqlite::Connection::open(&new_db).unwrap();
    let v: String = conn
        .query_row("SELECT x FROM probe", [], |r| r.get(0))
        .unwrap();
    assert_eq!(v, "日常数据");
    // 迁移前留了快照
    assert!(out.snapshot.map(|p| p.exists()).unwrap_or(false));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn second_run_is_idempotent() {
    let dir = tmp_dir("idem");
    make_legacy(&dir);
    let first = ensure(&dir).unwrap();
    let second = ensure(&dir).unwrap();
    assert!(first.migrated);
    assert!(!second.migrated, "第二次启动不应再搬一次");
    assert_eq!(second.registry.libraries.len(), 1);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fresh_install_creates_empty_library_named_default() {
    let dir = tmp_dir("fresh");
    let out = ensure(&dir).unwrap();
    assert!(!out.migrated);
    assert_eq!(out.registry.libraries[0].name, "日常");
    assert!(dir.join(&out.registry.libraries[0].dir).exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn wal_sidecars_move_along_with_the_db() {
    // 直接测搬运器:`ensure()` 会先 `VACUUM INTO` 快照,而 SQLite 打开库时会回收/截断
    // 那个假的 -wal,测不到"WAL 有没有跟着搬"这件事本身。
    let dir = tmp_dir("wal");
    let src = make_legacy(&dir);
    let dst_dir = dir.join("libraries/richang");
    std::fs::create_dir_all(&dst_dir).unwrap();
    let dst = dst_dir.join(library::LIB_DB_FILE);
    std::fs::write(format!("{}-wal", src.display()), b"fake-wal").unwrap();
    std::fs::write(format!("{}-shm", src.display()), b"fake-shm").unwrap();

    let moved = move_sidecars(&src, &dst).unwrap();
    assert_eq!(moved.len(), 3, "db + wal + shm 三个文件都要搬");
    assert!(dst.exists());
    assert!(std::path::Path::new(&format!("{}-wal", dst.display())).exists());
    assert!(std::path::Path::new(&format!("{}-shm", dst.display())).exists());
    assert!(!src.exists());

    // 回滚:三个文件都搬回原位,目录清掉
    rollback(&dst_dir, &src, &moved);
    assert!(src.exists());
    assert!(std::path::Path::new(&format!("{}-wal", src.display())).exists());
    assert!(!dst_dir.exists());
    let _ = std::fs::remove_dir_all(&dir);
}
