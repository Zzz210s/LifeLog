//! 多库注册表的纯逻辑用例(不碰 Tauri、不碰真库)。
use super::*;

fn lib(id: &str, name: &str) -> LibraryMeta {
    LibraryMeta {
        id: id.into(),
        name: name.into(),
        dir: rel_dir(id),
        created_at: stamp_now(),
    }
}

#[test]
fn normalize_name_trims_and_folds_whitespace() {
    assert_eq!(normalize_name("  日常  ").unwrap(), "日常");
    assert_eq!(normalize_name("写作  素材").unwrap(), "写作 素材");
}

#[test]
fn normalize_name_rejects_empty_and_too_long() {
    assert!(normalize_name("   ").is_err());
    let long = "字".repeat(NAME_MAX + 1);
    assert!(normalize_name(&long).is_err());
    assert!(normalize_name(&"字".repeat(NAME_MAX)).is_ok());
}

#[test]
fn normalize_name_rejects_control_chars() {
    assert!(normalize_name("日常\u{7}").is_err());
}

#[test]
fn new_lib_id_avoids_collisions() {
    let existing = vec![lib("lib-20260101T000000", "a")];
    let id = new_lib_id(&existing);
    assert!(!existing.iter().any(|l| l.id == id));
    // 同一批里再要一个:仍然不撞
    let mut more = existing.clone();
    more.push(lib(&id, "b"));
    let id2 = new_lib_id(&more);
    assert_ne!(id, id2);
}

#[test]
fn save_then_load_roundtrip() {
    let dir = std::env::temp_dir().join(format!("lifelog-lib-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let reg = Registry {
        current: "richang".into(),
        libraries: vec![lib(LEGACY_LIB_ID, LEGACY_LIB_NAME)],
    };
    save(&dir, &reg).unwrap();
    let back = load(&dir).unwrap().expect("刚写完应该读得到");
    assert_eq!(back.current, "richang");
    assert_eq!(back.libraries[0].name, "日常");
    // 找不到文件时返回 None(调用方据此走首次迁移)
    std::fs::remove_file(registry_path(&dir)).unwrap();
    assert!(load(&dir).unwrap().is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn empty_registry_is_an_error_not_a_silent_empty_app() {
    let dir = std::env::temp_dir().join(format!("lifelog-lib-empty-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(registry_path(&dir), r#"{"current":"","libraries":[]}"#).unwrap();
    assert!(load(&dir).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn db_path_is_inside_the_library_dir() {
    let app = std::path::Path::new("C:/data");
    let meta = lib("richang", "日常");
    let p = db_path(app, &meta);
    assert!(p.ends_with("libraries/richang/lifelog.db") || p.ends_with("libraries\\richang\\lifelog.db"));
}
