//! 安全阀单测(自 tests.rs 拆出以守 200 行上限):非快照路径拒绝、dry-run 只读、年容器校验。
use super::s1_tree;
use super::tests_support::{fixture, seed, tag};
use super::{run, Failure, Opts, Phase};
use rusqlite::Connection;
use std::sync::atomic::{AtomicUsize, Ordering};

/// 非快照路径 + `--apply` 无 `--allow-live` -> 退出码 2、库零变化
#[test]
fn s1_refuses_non_snapshot_path_without_allow_live() {
    static N: AtomicUsize = AtomicUsize::new(0);
    let path = std::env::temp_dir().join(format!(
        "lifelog-time-axis-{}-{}.db",
        std::process::id(),
        N.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_file(&path);
    {
        let mut c = Connection::open(&path).unwrap();
        crate::db::migrate::run(&c).unwrap();
        seed(&mut c);
    }
    let before = { s1_tree::readings(&Connection::open(&path).unwrap()).unwrap() };
    let err: Failure = run(&Opts {
        db: path.clone(),
        phase: Phase::Tree,
        apply: true,
        allow_live: false,
    })
    .unwrap_err();
    assert_eq!(err.code, 2, "{}", err.message);
    assert!(
        err.message.contains("_lifelog-snapshots"),
        "{}",
        err.message
    );
    assert_eq!(
        s1_tree::readings(&Connection::open(&path).unwrap()).unwrap(),
        before,
        "拒绝时库零变化"
    );
    let _ = std::fs::remove_file(&path);
}

/// dry-run 只读:抓计划不打库
#[test]
fn s1_plan_is_read_only() {
    let c = fixture();
    let before = s1_tree::readings(&c).unwrap();
    let plan = s1_tree::plan(&c).unwrap();
    assert_eq!(plan.deletes(), 3);
    assert!(plan.describe()[0].contains("搬移 2 个年容器"));
    assert_eq!(s1_tree::readings(&c).unwrap(), before);
}

/// 非 4 位年子级 -> 拒绝(码 2),库零变化
#[test]
fn s1_refuses_unexpected_child_class() {
    let c = fixture();
    tag(&c, "时间/日期/其他");
    let before = s1_tree::readings(&c).unwrap();
    let err = s1_tree::plan(&c).unwrap_err();
    assert_eq!(err.code, 2);
    assert!(err.message.contains("不是 4 位年容器"), "{}", err.message);
    assert_eq!(s1_tree::readings(&c).unwrap(), before);
}
