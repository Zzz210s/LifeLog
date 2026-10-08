//! 028 事务内前置钩子的用例:发号映射、settings 存 id 的键改写、默认筛选只在为空时写入,
//! 「钩子与迁移 SQL 同事务,SQL 报错则钩子产物一起回滚」,以及标量函数 `entity_name` /
//! `entity_key` 与共享向量(`fixtures/entity-meta.json`)+ 前端同源镜像的逐值一致。
use super::*;
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY, GRAPH_POSITIONS_KEY};
use migration_hooks::{build_id_map, ensure_default_filter, rewrite_settings_ids, MRU_NOTES_KEY,
                      UNIFY_META_VERSION};
use serde_json::Value;

/// 只建钩子需要的最小库:`entities`(发号)与 `settings`(改写/预置),不跑整条迁移链。
fn bare() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(
        "CREATE TABLE entities(id INTEGER PRIMARY KEY, kind TEXT NOT NULL);
         CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .unwrap();
    c
}

fn temp_table_exists(c: &Connection, name: &str) -> bool {
    c.query_row(
        "SELECT COUNT(*) FROM sqlite_temp_master WHERE name = ?1",
        [name],
        |r| r.get::<_, i64>(0),
    )
    .unwrap()
        > 0
}

fn user_version(c: &Connection) -> i64 {
    c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap()
}

/// 钩子与迁移 SQL 同事务:SQL 报错 -> `_id_map`、settings 半写、user_version 一起回滚。
#[test]
fn hook_products_roll_back_with_the_migration_sql() {
    let c = bare();
    c.execute_batch("INSERT INTO entities(id, kind) VALUES(3,'note'),(1000000001,'tag')")
        .unwrap();
    settings::set(&c, GRAPH_POSITIONS_KEY, r#"{"3":{"x":1}}"#).unwrap();
    let before = user_version(&c);

    let err = apply(&c, "SELECT * FROM no_such_table", UNIFY_META_VERSION);
    assert!(err.is_err(), "夹具 SQL 必须报错");
    assert!(!temp_table_exists(&c, "_id_map"), "临时表必须随事务回滚");
    assert_eq!(user_version(&c), before, "失败迁移不得推进版本号");
    assert!(
        settings::get(&c, FILTER_CURRENT_KEY).unwrap().is_none(),
        "ensure_default_filter 的写入必须一起回滚"
    );
    assert_eq!(
        settings::get(&c, GRAPH_POSITIONS_KEY).unwrap().unwrap(),
        r#"{"3":{"x":1}}"#,
        "rewrite_settings_ids 的写入必须一起回滚"
    );
}

/// 发号顺序:笔记在前按旧 id 升序,标签在后按旧 id 升序。
#[test]
fn id_map_orders_notes_before_tags() {
    let c = bare();
    // 额外插一个 id 比所有笔记都小的标签(2):真库标签 id 带 1e9 偏移、永远大于笔记,
    // 只有这个合成行能让 `(kind='tag')` 排序键成为可被变异测出的契约。
    c.execute_batch(
        "INSERT INTO entities(id, kind) VALUES
         (7,'note'),(3,'note'),(9,'note'),(2,'tag'),(1000000001,'tag'),(1000000005,'tag')",
    )
    .unwrap();
    build_id_map(&c).unwrap();
    let mut stmt = c.prepare("SELECT old_id, new_id FROM _id_map ORDER BY new_id").unwrap();
    let rows: Vec<(i64, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![(3, 1), (7, 2), (9, 3), (2, 4), (1000000001, 5), (1000000005, 6)],
        "笔记 {{3,7,9}} 先发 1..3,标签按旧 id {{2,1000000001,1000000005}} 再发 4..6"
    );
}

/// `graph_positions` 的键与 `ui.mru.notes` 的 id 按映射改写,不可映射的键/id 丢弃。
#[test]
fn settings_ids_are_rewritten_with_unmappable_dropped() {
    let c = bare();
    c.execute_batch(
        "INSERT INTO entities(id,kind) VALUES(7,'note'),(3,'note'),(9,'note'),(1000000001,'tag')",
    )
    .unwrap();
    build_id_map(&c).unwrap();
    settings::set(
        &c,
        GRAPH_POSITIONS_KEY,
        r#"{"7":{"x":1},"3":{"x":2},"1000000001":{"x":3},"1406":{"x":4},"bad":{"x":5}}"#,
    )
    .unwrap();
    settings::set(
        &c,
        MRU_NOTES_KEY,
        r#"[{"id":"7","count":2},{"id":"1406","count":1},{"count":9}]"#,
    )
    .unwrap();
    settings::set(&c, "ui.mru.tags", r#"["地点轴/日本"]"#).unwrap();

    rewrite_settings_ids(&c).unwrap();

    let gp: Value = serde_json::from_str(&settings::get(&c, GRAPH_POSITIONS_KEY).unwrap().unwrap())
        .unwrap();
    assert_eq!(gp["2"]["x"], 1, "7 -> 2");
    assert_eq!(gp["1"]["x"], 2, "3 -> 1");
    assert_eq!(gp["4"]["x"], 3, "1000000001 -> 4");
    assert_eq!(gp.as_object().unwrap().len(), 3, "不可映射的 1406 与坏键必须丢弃");
    let mru: Value = serde_json::from_str(&settings::get(&c, MRU_NOTES_KEY).unwrap().unwrap())
        .unwrap();
    assert_eq!(mru, serde_json::json!([{"id": "2", "count": 2}]), "1406 与缺 id 的条目丢弃");
    assert_eq!(
        settings::get(&c, "ui.mru.tags").unwrap().unwrap(),
        r#"["地点轴/日本"]"#,
        "存路径的键不参与改写"
    );
}

/// 坏 JSON 原样保留(不删设置),键不存在时钩子空操作、不创建设置项。
#[test]
fn bad_json_and_missing_keys_are_left_alone() {
    let c = bare();
    build_id_map(&c).unwrap();
    settings::set(&c, GRAPH_POSITIONS_KEY, "not json").unwrap();
    settings::set(&c, MRU_NOTES_KEY, "not json").unwrap();
    rewrite_settings_ids(&c).unwrap();
    assert_eq!(settings::get(&c, GRAPH_POSITIONS_KEY).unwrap().unwrap(), "not json");
    assert_eq!(settings::get(&c, MRU_NOTES_KEY).unwrap().unwrap(), "not json");

    let empty = bare();
    build_id_map(&empty).unwrap();
    rewrite_settings_ids(&empty).unwrap();
    assert!(settings::get(&empty, GRAPH_POSITIONS_KEY).unwrap().is_none());
    assert!(settings::get(&empty, MRU_NOTES_KEY).unwrap().is_none());
}

/// 默认筛选只在 `filter_current` 为空时写入;形状照 P0-4(`op='or'` 两项)。
#[test]
fn default_filter_is_written_only_when_empty() {
    let c = bare();
    ensure_default_filter(&c).unwrap();
    let raw = settings::get(&c, FILTER_CURRENT_KEY).unwrap().unwrap();
    let v: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(v["groupOp"], "and");
    assert_eq!(v["groups"][0]["op"], "or", "P0-4:一个 op='or' 的条件组");
    assert_eq!(v["groups"][0]["items"][0], serde_json::json!({"kind": "treeMembership", "value": "out"}));
    assert_eq!(v["groups"][0]["items"][1], serde_json::json!({"kind": "singleLine", "value": "multi"}));

    settings::set(
        &c,
        FILTER_CURRENT_KEY,
        r#"{"groupOp":"and","groups":[],"sort":"newest","sorts":[],"groupBy":null}"#,
    )
    .unwrap();
    ensure_default_filter(&c).unwrap();
    assert!(
        settings::get(&c, FILTER_CURRENT_KEY).unwrap().unwrap().contains("treeMembership"),
        "真库现状(空 groups)按空处理,重新预置"
    );

    settings::set(&c, FILTER_CURRENT_KEY, "   ").unwrap();
    ensure_default_filter(&c).unwrap();
    assert!(
        settings::get(&c, FILTER_CURRENT_KEY).unwrap().unwrap().contains("treeMembership"),
        "空白值按空处理,重新预置"
    );

    let with_cond = r#"{"groups":[{"op":"and","items":[{"kind":"keyword","value":"x"}]}]}"#;
    settings::set(&c, FILTER_CURRENT_KEY, with_cond).unwrap();
    ensure_default_filter(&c).unwrap();
    assert_eq!(
        settings::get(&c, FILTER_CURRENT_KEY).unwrap().unwrap(),
        with_cond,
        "已有有效条件的筛选不得覆盖"
    );
}
