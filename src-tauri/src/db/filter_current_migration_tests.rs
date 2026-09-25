//! 016 迁移:多页 tabs_state 的当前活动页条件搬进单份 filter_current(设计 §2)。
//! 四态(有旧键 / 无旧键 / 坏 JSON / 已存在 filter_current)+ 幂等,自 migrate_tests.rs 拆出。
use super::{apply, latest_version, run, MIGRATIONS};
use crate::db::repos::notes::FilterConditions;
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY};
use rusqlite::Connection;

/// 停在 v15(016 之前)的旧库;可选先写一份旧 tabs_state
fn legacy_db(tabs_state: Option<&str>) -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(15) {
        apply(&conn, sql, (i + 1) as i64).unwrap();
    }
    if let Some(raw) = tabs_state {
        settings::set(&conn, "tabs_state", raw).unwrap();
    }
    conn
}

fn filter_current(conn: &Connection) -> Option<String> {
    settings::get(conn, FILTER_CURRENT_KEY).unwrap()
}

fn version(conn: &Connection) -> i64 {
    conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap()
}

fn default_json() -> String {
    serde_json::to_string(&FilterConditions::default()).unwrap()
}

/// 旧库原文:两页 + activeIndex=1(前端 use-tabs 落库的形状)
const LEGACY: &str = r##"{"tabs":[{"title":"甲","conditions":{"keyword":null,"tags":[{"path":"工作","includeChildren":true}],"excludeTags":[],"tagPresence":null,"sort":"newest","expr":null}},{"title":"乙","conditions":{"keyword":"复盘","tags":[{"path":"生活","includeChildren":false}],"excludeTags":[],"tagPresence":"any","sort":"oldest","expr":"#生活"}}],"activeIndex":1}"##;

/// ① 有旧键且 activeIndex=1(多页)-> filter_current = 第 1 页条件,旧键消失
#[test]
fn migration_016_carries_active_page_conditions() {
    let conn = legacy_db(Some(LEGACY));

    run(&conn).unwrap();

    assert_eq!(version(&conn), latest_version());
    assert_eq!(settings::get(&conn, "tabs_state").unwrap(), None, "旧键必须删除");
    let c: FilterConditions = serde_json::from_str(&filter_current(&conn).unwrap()).unwrap();
    assert_eq!(c.keyword.as_deref(), Some("复盘"), "取的是 activeIndex 指向的那一页");
    assert_eq!(c.tags.len(), 1);
    assert_eq!(c.tags[0].path, "生活");
    assert!(!c.tags[0].include_children);
    assert_eq!(c.tag_presence.as_deref(), Some("any"));
    assert_eq!(c.sort.as_deref(), Some("oldest"));
    assert_eq!(c.expr.as_deref(), Some("#生活"));
}

/// ② 无旧键 -> filter_current 不被创建(读回 None)
#[test]
fn migration_016_without_legacy_key_creates_nothing() {
    let conn = legacy_db(None);

    run(&conn).unwrap();

    assert_eq!(version(&conn), latest_version());
    assert_eq!(filter_current(&conn), None, "无旧值时不得凭空创建 filter_current");
}

/// ③ 旧键坏 JSON -> filter_current = 默认空条件(不丢键、不留旧键)
#[test]
fn migration_016_with_bad_legacy_json_falls_back_to_empty() {
    let conn = legacy_db(Some("不是 JSON"));

    run(&conn).unwrap();

    assert_eq!(filter_current(&conn).unwrap(), default_json(), "解析失败退化为空条件");
    assert_eq!(settings::get(&conn, "tabs_state").unwrap(), None);
}

/// ③b activeIndex 越界 -> **取第一页**(与前端 parseTabsState 的夹取口径一致);
/// 缺 conditions / 没有可用条目 -> 退化空条件
#[test]
fn migration_016_out_of_range_index_uses_first_page() {
    let out_of_range = r#"{"tabs":[{"conditions":{"keyword":"甲"}}],"activeIndex":7}"#;
    let conn = legacy_db(Some(out_of_range));
    run(&conn).unwrap();
    let got = filter_current(&conn).unwrap();
    assert!(got.contains("甲"), "越界应沿用第一页条件,实得 {got}");

    let no_conditions = r#"{"tabs":[{"title":"空"}],"activeIndex":0}"#;
    let conn = legacy_db(Some(no_conditions));
    run(&conn).unwrap();
    assert_eq!(filter_current(&conn).unwrap(), default_json());
}

/// ④ 已有 filter_current -> 不被覆盖,旧键仍被删除
#[test]
fn migration_016_keeps_existing_filter_current_and_drops_legacy() {
    let existing = r#"{"keyword":"新口径","tags":[],"excludeTags":[],"tagPresence":null,"sort":"newest","expr":null}"#;
    let conn = legacy_db(Some(LEGACY));
    settings::set(&conn, FILTER_CURRENT_KEY, existing).unwrap();

    run(&conn).unwrap();

    assert_eq!(filter_current(&conn).unwrap(), existing, "已存在则不得覆盖");
    assert_eq!(settings::get(&conn, "tabs_state").unwrap(), None, "旧键仍要删除");
}

/// 幂等:版本闸门之外,重放 016 的 SQL 也是空操作
#[test]
fn migration_016_is_idempotent() {
    let conn = legacy_db(Some(LEGACY));
    run(&conn).unwrap();
    let snapshot = || (version(&conn), filter_current(&conn), settings::get(&conn, "tabs_state").unwrap());

    let first = snapshot();
    run(&conn).unwrap(); // 第二次:版本闸门不放行
    assert_eq!(snapshot(), first);

    let sql = MIGRATIONS[15];
    conn.execute_batch(sql).unwrap();
    conn.execute_batch(sql).unwrap(); // 本体重放两次
    assert_eq!(snapshot(), first, "重放 016 不得改库");
}
