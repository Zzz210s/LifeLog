//! 标签页条件级联测试(tabs_rewrite.rs 的子模块):表达式文本级改写的前缀规则,
//! 以及 settings.tabs_state 全量重写的读数(改写范围 / 保留字段 / 坏数据不动)。
use super::{rewrite_expr_paths, rewrite_prefix};
use crate::db::repos::settings::{self, TABS_STATE_KEY};
use crate::db::migrate;
use rusqlite::Connection;
use serde_json::{json, Value};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 三个标签页:待改写的页 / 不该动的页 / 坏条件页
fn seed(conn: &Connection) -> String {
    let value = json!({
        "tabs": [
            {
                "title": "工作页",
                "conditions": {
                    "keyword": "复盘",
                    "tags": [{"path": "工作/项目A", "includeChildren": true}],
                    "excludeTags": [{"path": "工作", "includeChildren": false}],
                    "tagPresence": null,
                    "sort": "oldest",
                    "expr": "#工作 AND NOT #工作2 AND #=工作/项目A"
                }
            },
            {
                "title": "",
                "conditions": {
                    "keyword": null,
                    "tags": [{"path": "生活", "includeChildren": true}],
                    "excludeTags": [],
                    "tagPresence": null,
                    "sort": "newest",
                    "expr": null
                }
            },
            { "title": "坏页", "conditions": "不是对象" }
        ],
        "activeIndex": 1
    });
    settings::set(conn, TABS_STATE_KEY, &value.to_string()).unwrap();
    value.to_string()
}

fn read(conn: &Connection) -> Value {
    let raw = settings::get(conn, TABS_STATE_KEY).unwrap().unwrap();
    serde_json::from_str(&raw).unwrap()
}

#[test]
fn rewrite_expr_paths_follows_prefix_rule() {
    assert_eq!(
        rewrite_expr_paths("#=工作/项目A AND NOT #工作2", "工作/项目A", "工作/项目X"),
        "#=工作/项目X AND NOT #工作2"
    );
    assert_eq!(
        rewrite_expr_paths("#工作 AND #工作/项目A", "工作", "职业"),
        "#职业 AND #职业/项目A"
    );
    assert_eq!(rewrite_expr_paths("复盘 AND #工作", "工作", "职业"), "复盘 AND #职业");
}

#[test]
fn rewrite_expr_paths_keeps_other_tokens_verbatim() {
    assert_eq!(
        rewrite_expr_paths("#a OR (#a AND NOT #a)", "a", "b"),
        "#b OR (#b AND NOT #b)"
    );
    let untouched = "关键词 2026 AND \"含 #工作 的短语\"";
    assert_eq!(rewrite_expr_paths(untouched, "工作", "职业"), untouched, "文本逐字保留");
    assert_eq!(rewrite_expr_paths("#=a", "a", "b"), "#=b");
    // 词法失败(未闭合引号)时原文不动
    assert_eq!(rewrite_expr_paths("#a AND \"未闭合", "a", "b"), "#a AND \"未闭合");
}

#[test]
fn rewrite_prefix_rewrites_tags_and_expr_of_every_tab() {
    let c = db();
    seed(&c);

    rewrite_prefix(&c, "工作", "职业").unwrap();

    let out = read(&c);
    let tabs = out["tabs"].as_array().unwrap();
    assert_eq!(tabs.len(), 3, "标签页数量不变");
    assert_eq!(out["activeIndex"], json!(1), "当前选中页不变");
    let c0 = &tabs[0]["conditions"];
    assert_eq!(c0["tags"][0]["path"], json!("职业/项目A"));
    assert_eq!(c0["tags"][0]["includeChildren"], json!(true), "其余字段原样保留");
    assert_eq!(c0["excludeTags"][0]["path"], json!("职业"));
    assert_eq!(
        c0["expr"],
        json!("#职业 AND NOT #工作2 AND #=职业/项目A"),
        "表达式 token 级前缀改写,非本前缀的 #工作2 不动"
    );
    assert_eq!(c0["keyword"], json!("复盘"), "关键词不参与路径改写");
    assert_eq!(tabs[0]["title"], json!("工作页"), "标题不动");
}

#[test]
fn rewrite_prefix_leaves_other_tabs_and_bad_rows_untouched() {
    let c = db();
    let before = seed(&c);

    rewrite_prefix(&c, "不存在的标签", "新名").unwrap();

    assert_eq!(
        settings::get(&c, TABS_STATE_KEY).unwrap().unwrap(),
        before,
        "没有命中的路径不得改写(整串逐字不变)"
    );
    let after_seed = read(&c);
    rewrite_prefix(&c, "工作", "职业").unwrap();
    let after = read(&c);
    assert_eq!(after["tabs"][1], after_seed["tabs"][1], "无关标签页逐字不动");
    assert_eq!(after["tabs"][2], after_seed["tabs"][2], "坏条件页跳过、不自作修复");
}

/// 前端 use-tabs 真正写进 settings.tabs_state 的形状(浏览器实测台的持久化原文):
/// 二元素 tabs + 中文标题 + camelCase 条件 —— Rust 侧必须原样读懂并只改路径
#[test]
fn rewrite_prefix_reads_frontend_persisted_shape() {
    let c = db();
    let raw = "{\"tabs\":[{\"title\":\"\",\"conditions\":{\"keyword\":null,\"tags\":[],\"excludeTags\":[],\"tagPresence\":null,\"sort\":\"newest\",\"expr\":null}},{\"title\":\"我的待办\",\"conditions\":{\"keyword\":null,\"tags\":[{\"path\":\"待办\",\"includeChildren\":true}],\"excludeTags\":[],\"tagPresence\":null,\"sort\":\"newest\",\"expr\":null}}],\"activeIndex\":1}";
    settings::set(&c, TABS_STATE_KEY, raw).unwrap();

    rewrite_prefix(&c, "待办", "待办清单").unwrap();

    let out = read(&c);
    assert_eq!(out["tabs"][1]["title"], json!("我的待办"), "中文标题原样保留");
    assert_eq!(out["tabs"][1]["conditions"]["tags"][0]["path"], json!("待办清单"));
    assert_eq!(out["tabs"][1]["conditions"]["tags"][0]["includeChildren"], json!(true));
    assert_eq!(out["tabs"][0], json!({"title":"","conditions":{"keyword":null,"tags":[],"excludeTags":[],"tagPresence":null,"sort":"newest","expr":null}}), "无关页逐字不动");
}

#[test]
fn rewrite_prefix_is_noop_without_key_or_with_bad_json() {
    let c = db();
    rewrite_prefix(&c, "工作", "职业").unwrap(); // 键缺失:无操作不报错
    assert_eq!(settings::get(&c, TABS_STATE_KEY).unwrap(), None);

    settings::set(&c, TABS_STATE_KEY, "不是 JSON").unwrap();
    rewrite_prefix(&c, "工作", "职业").unwrap();
    assert_eq!(settings::get(&c, TABS_STATE_KEY).unwrap().unwrap(), "不是 JSON");

    settings::set(&c, TABS_STATE_KEY, "{\"tabs\":\"不是数组\"}").unwrap();
    rewrite_prefix(&c, "工作", "职业").unwrap();
    assert_eq!(
        settings::get(&c, TABS_STATE_KEY).unwrap().unwrap(),
        "{\"tabs\":\"不是数组\"}"
    );
}
