//! 027 前置钩子的读数:`graph_positions` 键从老标签 id 改写成标签实体 id(幂等、坏键丢弃),
//! `entities.legacy_id` 按列存在性下架,`ui.mru.*` 不受影响。
use super::entities_tags_fixture::{count, migrated_to_v26};
use super::*;
use crate::db::repos::settings;

fn set_gp(c: &Connection, value: &str) {
    settings::set(c, settings::GRAPH_POSITIONS_KEY, value).unwrap();
}

fn get_gp(c: &Connection) -> String {
    settings::get(c, settings::GRAPH_POSITIONS_KEY).unwrap().unwrap()
}

/// 真库形态的键(`{"283":…,"321":…}`)+ 一个坏键:改写的键全部 +偏移,坏键丢弃。
#[test]
fn graph_positions_keys_are_shifted() {
    let c = migrated_to_v26();
    set_gp(&c, r#"{"283":{"x":1,"y":2},"321":{"x":3,"y":4},"bad":{"x":9}}"#);
    run(&c).unwrap();
    let v: serde_json::Value = serde_json::from_str(&get_gp(&c)).unwrap();
    assert_eq!(v["1000000283"]["x"], 1, "老键 283 -> 实体 id 1000000283");
    assert_eq!(v["1000000321"]["y"], 4, "老键 321 -> 实体 id 1000000321");
    assert!(v.get("283").is_none(), "老键不得残留");
    assert!(v.get("bad").is_none(), "解析失败的键必须丢弃");
}

/// 已经是实体区间的键再跑一次不被二次偏移(钩子在事务外,崩溃重放必须幂等)。
#[test]
fn shifted_keys_are_not_double_shifted() {
    let c = migrated_to_v26();
    set_gp(&c, r#"{"1000000283":{"x":1}}"#);
    migration_hooks::rewrite_graph_positions(&c).unwrap();
    let first = get_gp(&c);
    migration_hooks::rewrite_graph_positions(&c).unwrap();
    assert_eq!(get_gp(&c), first, "重放不得再偏移");
    assert!(first.contains("1000000283"));
}

/// 坏 JSON 原样保留(不删设置),下次启动仍能重跑。
#[test]
fn bad_json_is_left_untouched() {
    let c = migrated_to_v26();
    set_gp(&c, "not json");
    run(&c).unwrap();
    assert_eq!(get_gp(&c), "not json");
}

/// 键不存在时钩子空操作,不创建设置项。
#[test]
fn missing_key_is_a_noop() {
    let c = migrated_to_v26();
    run(&c).unwrap();
    assert!(settings::get(&c, settings::GRAPH_POSITIONS_KEY).unwrap().is_none());
}

/// `entities.legacy_id` 在 027 被下架(列存在性守卫)。
#[test]
fn legacy_id_column_is_dropped() {
    let c = migrated_to_v26();
    let before = count(
        &c,
        "SELECT COUNT(*) FROM pragma_table_info('entities') WHERE name='legacy_id'",
    );
    assert_eq!(before, 1, "v26 时过渡列还在");
    run(&c).unwrap();
    let after = count(
        &c,
        "SELECT COUNT(*) FROM pragma_table_info('entities') WHERE name='legacy_id'",
    );
    assert_eq!(after, 0, "027 后过渡列必须下架");
}

/// `ui.mru.notes`(笔记 id)与 `ui.mru.tags`(路径)不参与改写,原样保留。
#[test]
fn mru_settings_are_untouched() {
    let c = migrated_to_v26();
    settings::set(&c, "ui.mru.notes", r#"["501","502"]"#).unwrap();
    settings::set(&c, "ui.mru.tags", r#"["地点轴/日本"]"#).unwrap();
    run(&c).unwrap();
    assert_eq!(settings::get(&c, "ui.mru.notes").unwrap().unwrap(), r#"["501","502"]"#);
    assert_eq!(settings::get(&c, "ui.mru.tags").unwrap().unwrap(), r#"["地点轴/日本"]"#);
}
