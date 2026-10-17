//! 批量命令层的纯函数用例(spec 2026-10-17 §6.3):快照目录的优先级与兜底。
use super::resolve_snapshot_dir;
use std::path::PathBuf;

fn tmp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("lifelog-snapdir-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    d
}

#[test]
fn env_override_wins() {
    let prefer = tmp("env-prefer");
    let fallback = PathBuf::from("C:/fallback");
    let got = resolve_snapshot_dir(Some("D:/snaps".into()), &prefer, fallback);
    assert_eq!(got, PathBuf::from("D:/snaps"));
    assert!(!prefer.exists(), "环境变量优先时不该动约定目录");
}

#[test]
fn blank_env_is_ignored() {
    let prefer = tmp("blank");
    let got = resolve_snapshot_dir(Some("   ".into()), &prefer, PathBuf::from("C:/fallback"));
    assert_eq!(got, prefer);
    assert!(prefer.exists(), "空环境变量应回落到约定目录并把它建出来");
    let _ = std::fs::remove_dir_all(&prefer);
}

#[test]
fn uncreatable_prefer_falls_back() {
    // 拿一个文件当目录:create_dir_all 必失败 -> 回退
    let file = tmp("file");
    std::fs::write(&file, b"x").unwrap();
    let fallback = PathBuf::from("C:/fallback");
    let got = resolve_snapshot_dir(None, &file, fallback.clone());
    assert_eq!(got, fallback);
    let _ = std::fs::remove_file(&file);
}

#[test]
fn creates_prefer_when_missing() {
    let prefer = tmp("create") .join("nested");
    assert!(!prefer.exists());
    let got = resolve_snapshot_dir(None, &prefer, PathBuf::from("C:/fallback"));
    assert_eq!(got, prefer);
    assert!(got.exists());
    let _ = std::fs::remove_dir_all(tmp("create"));
}
