//! 批量删除仓库层用例(spec 2026-10-17 §4.3 / §6/§11.1):快照生成、命名冲突、`gc_orphans`、单事务回滚。
use super::{delete_many, snapshot_path};
use crate::db::migrate;
use rusqlite::{params, Connection};
use std::path::PathBuf;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 每条用例自己的临时快照目录(进程内唯一,先清空)。
fn tmpdir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("lifelog-batch-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    d
}

/// 笔记 1/2 + 标签 10;1 与 2 都指向 10(默认共享,验证 gc 不误删)。
fn seed(c: &Connection) {
    c.execute_batch(
        "INSERT INTO points(id, meta, created_at, path, depth) VALUES
           (1, '笔记甲', '2026-01-01', NULL, NULL),
           (2, '笔记乙', '2026-01-01', NULL, NULL),
           (10, '目标', '2026-01-01', '目标', 1);
         INSERT INTO lines(id, from_id, to_id, name_id) VALUES
           (100, 1, 10, NULL),
           (101, 2, 10, NULL);",
    )
    .unwrap();
}

fn exists(c: &Connection, id: i64) -> bool {
    c.query_row("SELECT EXISTS(SELECT 1 FROM points WHERE id = ?1)", params![id], |r| r.get(0))
        .unwrap()
}

#[test]
fn delete_writes_snapshot_and_removes_points() {
    let mut c = db();
    seed(&c);
    let dir = tmpdir("snap");
    let r = delete_many(&mut c, &[1], &dir).unwrap();
    assert_eq!(r.deleted, 1);
    assert!(!exists(&c, 1));
    assert!(exists(&c, 2));
    assert!(r.snapshot.exists(), "快照必须落盘: {}", r.snapshot.display());
    let size = std::fs::metadata(&r.snapshot).unwrap().len();
    assert!(size > 0, "快照不能是空文件");
    assert!(r.snapshot.file_name().unwrap().to_string_lossy().starts_with("batch-delete-"));
    let _ = std::fs::remove_dir_all(&dir);
}

/// gc 收尾:标签 10 只剩 1 的引用,删掉 1 后应作为空壳被回收。
#[test]
fn delete_reclaims_orphan_tag() {
    let mut c = db();
    seed(&c);
    // 让 10 只被 1 引用(去掉 2 的线)
    c.execute("DELETE FROM lines WHERE id = 101", []).unwrap();
    let dir = tmpdir("gc");
    delete_many(&mut c, &[1], &dir).unwrap();
    assert!(!exists(&c, 10), "失去最后引用的树内空壳应由 gc_orphans 回收");
    let _ = std::fs::remove_dir_all(&dir);
}

/// 仍被别的条目引用的标签不回收。
#[test]
fn delete_keeps_shared_tag() {
    let mut c = db();
    seed(&c);
    let dir = tmpdir("shared");
    delete_many(&mut c, &[1], &dir).unwrap();
    assert!(exists(&c, 10), "还有引用者的标签不能被回收");
    let _ = std::fs::remove_dir_all(&dir);
}

/// 不存在的 id 跳过,deleted 只数实际删掉的行数(快照仍生成)。
#[test]
fn delete_skips_missing_ids() {
    let mut c = db();
    seed(&c);
    let dir = tmpdir("missing");
    let r = delete_many(&mut c, &[999, 1], &dir).unwrap();
    assert_eq!(r.deleted, 1);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 同名冲突不覆盖:第二次调用改用 `-2`。
#[test]
fn snapshot_name_avoids_overwrite() {
    let dir = tmpdir("collide");
    std::fs::create_dir_all(&dir).unwrap();
    let first = snapshot_path(&dir, "20260101T000000");
    std::fs::write(&first, b"x").unwrap();
    let second = snapshot_path(&dir, "20260101T000000");
    assert_ne!(first, second);
    assert!(second.to_string_lossy().ends_with("-2.db"), "{}", second.display());
    let _ = std::fs::remove_dir_all(&dir);
}

/// 单事务回滚:中途删除失败时,先删的点也要回来。
#[test]
fn rollback_leaves_points() {
    let mut c = db();
    seed(&c);
    c.execute_batch(
        "CREATE TRIGGER boom BEFORE DELETE ON points
         WHEN OLD.id = 2 BEGIN SELECT RAISE(ABORT, 'boom'); END;",
    )
    .unwrap();
    let dir = tmpdir("rollback");
    let err = delete_many(&mut c, &[1, 2], &dir).unwrap_err();
    assert!(err.contains("boom"), "应冒出底层失败: {err}");
    assert!(exists(&c, 1), "回滚后先删的点必须还在");
    assert!(exists(&c, 2));
    let _ = std::fs::remove_dir_all(&dir);
}
