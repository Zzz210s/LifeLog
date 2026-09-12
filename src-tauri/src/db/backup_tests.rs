//! 迁移前备份的纯逻辑测试:备份命名与保留策略(prune)。
use super::{backup_name, backups_to_prune};

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
