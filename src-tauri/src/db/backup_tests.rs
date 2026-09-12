//! 迁移前备份的纯逻辑测试:备份命名、保留策略(prune)、检查点 busy 校验与复制失败清理。
use super::{
    backup_name, backup_stamp, backups_to_prune, checkpoint_truncate, checkpoint_warning, copy_snapshot,
};
use rusqlite::Connection;
use std::path::Path;

fn tmp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("lifelog-bak-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn prune_keeps_newest_n() {
    let names = vec![
        "lifelog.db.bak-4-20260910T101010".to_string(),
        "lifelog.db.bak-3-20260911T090000".to_string(),
        "lifelog.db.bak-4-20260912T080000".to_string(),
    ];
    assert_eq!(
        backups_to_prune(names, 2),
        vec!["lifelog.db.bak-4-20260910T101010".to_string()]
    );
}

#[test]
fn prune_keeps_all_when_under_limit() {
    assert!(backups_to_prune(vec!["a".into()], 3).is_empty());
}

#[test]
fn prune_keeps_all_when_exactly_at_limit() {
    let names = vec!["lifelog.db.bak-5-20260912T080000".to_string()];
    assert!(backups_to_prune(names, 1).is_empty());
}

#[test]
fn backup_name_carries_old_version_and_stamp() {
    assert_eq!(
        backup_name("lifelog.db", 5, "20260912T101010"),
        "lifelog.db.bak-5-20260912T101010"
    );
}

#[test]
fn stamp_parsing_is_strict() {
    assert_eq!(
        backup_stamp("lifelog.db.bak-6-20260912T134211"),
        Some("20260912T134211".to_string())
    );
    // 边车、手工副本与畸形名一律不认
    assert!(backup_stamp("lifelog.db.bak-6-20260912T134211-wal").is_none());
    assert!(backup_stamp("lifelog.db.bak-6-20260912T134211-shm").is_none());
    assert!(backup_stamp("lifelog.db.bak-6-manual").is_none());
    assert!(backup_stamp("lifelog.db.bak-x-20260912T134211").is_none());
    assert!(backup_stamp("lifelog.db.bak-6-2026091T13421").is_none());
    assert!(backup_stamp("lifelog.db.bak-6-20260912X134211").is_none());
    assert!(backup_stamp("lifelog.db").is_none());
}

#[test]
fn prune_ignores_sidecars_and_manual_copies() {
    // 关键回归(审查 I-1):`...-wal` 按旧排序键会被当成"最新",从而挤掉真快照
    let names = vec![
        "lifelog.db.bak-4-20260910T101010".to_string(),
        "lifelog.db.bak-4-20260911T101010".to_string(),
        "lifelog.db.bak-4-20260912T101010".to_string(),
        "lifelog.db.bak-4-20260912T101010-wal".to_string(),
        "lifelog.db.bak-4-20260912T101010-shm".to_string(),
        "lifelog.db.bak-9-manual".to_string(),
        "lifelog.db.bak-4-20260912T1010".to_string(),
    ];
    assert_eq!(
        backups_to_prune(names, 2),
        vec!["lifelog.db.bak-4-20260910T101010".to_string()]
    );
}

#[test]
fn checkpoint_on_healthy_db_reports_not_busy() {
    let dir = tmp_dir("ckpt");
    let conn = Connection::open(dir.join("t.db")).unwrap();
    let _: String = conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0)).unwrap();
    assert_eq!(checkpoint_truncate(&conn).unwrap(), 0);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn busy_checkpoint_warns_in_chinese() {
    assert!(checkpoint_warning(0).is_none());
    let warning = checkpoint_warning(1).unwrap();
    assert!(warning.contains("WAL 未截断") && warning.contains("busy=1"));
}

#[test]
fn failed_copy_removes_partial_snapshot() {
    let dir = tmp_dir("copy");
    let dest = dir.join("lifelog.db.bak-6-20260912T101010");
    std::fs::write(&dest, b"half-written").unwrap(); // 模拟复制中途留下的半截文件
    let err = copy_snapshot(Path::new("not-a-file"), &dest, &|_, _| {
        Err(std::io::Error::new(std::io::ErrorKind::Other, "磁盘已满"))
    })
    .unwrap_err();
    assert!(err.contains("复制数据库失败"));
    assert!(!dest.exists(), "复制失败后不得留下半截 .bak");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn successful_copy_keeps_snapshot() {
    let dir = tmp_dir("copy-ok");
    let src = dir.join("src.db");
    let dest = dir.join("lifelog.db.bak-6-20260912T101010");
    std::fs::write(&src, b"payload").unwrap();
    copy_snapshot(&src, &dest, &|s, d| std::fs::copy(s, d)).unwrap();
    assert_eq!(std::fs::read(&dest).unwrap(), b"payload");
    let _ = std::fs::remove_dir_all(&dir);
}
