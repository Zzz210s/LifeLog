//! 027/028 前置钩子的读数:`graph_positions` 键先由 027 从老标签 id 偏移、再由 028 映射到
//! 新实体 id(不可映射的键丢弃),`ui.mru.notes` 的笔记 id 同样改写,`ui.mru.tags`(路径)不受影响。
use super::entities_tags_fixture::{count, migrated_to_v26};
use super::*;
use crate::db::repos::settings;

fn set_gp(c: &Connection, value: &str) {
    settings::set(c, settings::GRAPH_POSITIONS_KEY, value).unwrap();
}

fn get_gp(c: &Connection) -> String {
    settings::get(c, settings::GRAPH_POSITIONS_KEY).unwrap().unwrap()
}

/// 真库形态的键(`{"283":…,"321":…}` 那种老标签 id)+ 一个坏键:可映射的键改写,坏键丢弃。
/// 夹具 v26:笔记 501/502 + 标签 id 1000000001..3;028 重发为 笔记 1/2、标签 3/4/5。
#[test]
fn graph_positions_keys_are_shifted() {
    let c = migrated_to_v26();
    set_gp(&c, r#"{"1":{"x":1,"y":2},"2":{"x":3,"y":4},"bad":{"x":9}}"#);
    run(&c).unwrap();
    let v: serde_json::Value = serde_json::from_str(&get_gp(&c)).unwrap();
    assert_eq!(v["3"]["x"], 1, "老标签 id 1(027 偏移后 1000000001)-> 实体 id 3");
    assert_eq!(v["4"]["y"], 4, "老标签 id 2 -> 实体 id 4");
    assert!(
        v.get("1").is_none() && v.get("1000000001").is_none(),
        "中间态键不得残留"
    );
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

/// `ui.mru.notes` 的笔记 id 由 028 改写为新实体 id;`ui.mru.tags` 存路径,原样保留。
#[test]
fn mru_settings_note_ids_follow_entities() {
    let c = migrated_to_v26();
    settings::set(&c, "ui.mru.notes", r#"[{"id":"501","count":2}]"#).unwrap();
    settings::set(&c, "ui.mru.tags", r#"["地点轴/日本"]"#).unwrap();
    run(&c).unwrap();
    let mru: serde_json::Value =
        serde_json::from_str(&settings::get(&c, "ui.mru.notes").unwrap().unwrap()).unwrap();
    assert_eq!(mru[0]["id"], "1", "笔记 501 -> 实体 id 1");
    assert_eq!(mru[0]["count"].as_i64(), Some(2), "其余字段原样保留");
    assert_eq!(settings::get(&c, "ui.mru.tags").unwrap().unwrap(), r#"["地点轴/日本"]"#);
}
