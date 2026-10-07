//! 改名校级联到 `groupBy.path` 与旧 JSON 回读(T4):级联漏了分组轴只会静默分错组
//! (分组不算收窄条件,不报错、不重查),所以与 `sorts[].path` 一样必须在同一事务里改写。
use super::rewrite_filter_paths;
use crate::db::migrate;
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY};
use rusqlite::Connection;
use serde_json::{json, Value};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn seed(conn: &Connection, value: &Value) {
    settings::set(conn, FILTER_CURRENT_KEY, &value.to_string()).unwrap();
}

fn read(conn: &Connection) -> Value {
    let raw = settings::get(conn, FILTER_CURRENT_KEY).unwrap().unwrap();
    serde_json::from_str(&raw).unwrap()
}

#[test]
fn rename_rewrites_group_by_axis_and_sort_axis_together() {
    let c = db();
    seed(
        &c,
        &json!({
            "groupOp": "and",
            "groups": [],
            "sorts": [{"kind": "tag", "path": "地点/中国大陆", "dir": "asc", "enabled": true}],
            "groupBy": {"path": "地点/中国大陆/四川省", "dir": "desc"}
        }),
    );
    rewrite_filter_paths(&c, "地点/中国大陆", "地点/中国").unwrap();
    let out = read(&c);
    assert_eq!(out["groupBy"]["path"], json!("地点/中国/四川省"), "分组轴要跟着改名走");
    assert_eq!(out["groupBy"]["dir"], json!("desc"), "其余字段原样保留");
    assert_eq!(out["sorts"][0]["path"], json!("地点/中国"), "排序轴仍照旧改写");
}

#[test]
fn group_by_untouched_when_path_not_matched_and_absent_json_stays_absent() {
    let c = db();
    let raw = json!({
        "groupOp": "and",
        "groups": [],
        "sorts": [],
        "groupBy": {"path": "地点/日本", "dir": "asc"}
    })
    .to_string();
    settings::set(&c, FILTER_CURRENT_KEY, &raw).unwrap();
    rewrite_filter_paths(&c, "工作", "职业").unwrap();
    let kept = settings::get(&c, FILTER_CURRENT_KEY).unwrap().unwrap();
    assert_eq!(kept, raw, "没有路径命中时整串逐字保留");
    // 旧 JSON(没有 groupBy 键)改写后也不应凭空多出分组轴
    let legacy = json!({"tags": [{"path": "工作/项目A", "includeChildren": true}]}).to_string();
    settings::set(&c, FILTER_CURRENT_KEY, &legacy).unwrap();
    rewrite_filter_paths(&c, "工作", "职业").unwrap();
    let out = read(&c);
    assert_eq!(out["groupBy"], json!(null), "旧 JSON 不该被补出分组轴");
    assert_eq!(out["groups"][0]["items"][0]["path"], json!("职业/项目A"));
}
