//! 筛选条件路径级联测试(filter_rewrite.rs 的子模块):表达式文本级改写的前缀规则,
//! 以及 settings.filter_current 单份条件的重写读数(改写范围 / 保留字段 / 坏数据不动)。
use super::{rewrite_expr_paths, rewrite_filter_paths};
use crate::db::migrate;
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY};
use rusqlite::Connection;
use serde_json::{json, Value};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 一份条件:含待改写的路径与不该动的字段(与前端落库形状逐字段一致)
fn seed(conn: &Connection) -> String {
    let value = json!({
        "keyword": "复盘",
        "tags": [{"path": "工作/项目A", "includeChildren": true}],
        "excludeTags": [{"path": "工作", "includeChildren": false}],
        "tagPresence": null,
        "sort": "oldest",
        "expr": "#工作 AND NOT #工作2 AND #=工作/项目A"
    });
    settings::set(conn, FILTER_CURRENT_KEY, &value.to_string()).unwrap();
    value.to_string()
}

fn read(conn: &Connection) -> Value {
    let raw = settings::get(conn, FILTER_CURRENT_KEY).unwrap().unwrap();
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
fn rewrite_filter_paths_rewrites_tags_and_expr() {
    let c = db();
    seed(&c);

    rewrite_filter_paths(&c, "工作", "职业").unwrap();

    let out = read(&c);
    assert_eq!(out["tags"][0]["path"], json!("职业/项目A"));
    assert_eq!(out["tags"][0]["includeChildren"], json!(true), "其余字段原样保留");
    assert_eq!(out["excludeTags"][0]["path"], json!("职业"));
    assert_eq!(
        out["expr"],
        json!("#职业 AND NOT #工作2 AND #=职业/项目A"),
        "表达式 token 级前缀改写,非本前缀的 #工作2 不动"
    );
    assert_eq!(out["keyword"], json!("复盘"), "关键词不参与路径改写");
    assert_eq!(out["sort"], json!("oldest"), "排序不动");
    assert_eq!(out["tagPresence"], json!(null), "标签有无不动");
}

#[test]
fn rewrite_filter_paths_without_hit_keeps_raw_verbatim() {
    let c = db();
    let before = seed(&c);

    rewrite_filter_paths(&c, "不存在的标签", "新名").unwrap();

    assert_eq!(
        settings::get(&c, FILTER_CURRENT_KEY).unwrap().unwrap(),
        before,
        "没有命中的路径不得改写(整串逐字不变)"
    );
}

/// 前端真正写进 settings.filter_current 的形状(浏览器实测台的持久化原文,单份条件对象):
/// camelCase 字段 —— Rust 侧必须原样读懂并只改路径
#[test]
fn rewrite_filter_paths_reads_frontend_persisted_shape() {
    let c = db();
    let raw = "{\"keyword\":null,\"tags\":[{\"path\":\"待办\",\"includeChildren\":true}],\"excludeTags\":[],\"tagPresence\":null,\"sort\":\"newest\",\"expr\":null}";
    settings::set(&c, FILTER_CURRENT_KEY, raw).unwrap();

    rewrite_filter_paths(&c, "待办", "待办清单").unwrap();

    let out = read(&c);
    assert_eq!(out["tags"][0]["path"], json!("待办清单"));
    assert_eq!(out["tags"][0]["includeChildren"], json!(true));
    assert_eq!(out["excludeTags"], json!([]), "空排除列表原样保留");
    assert_eq!(out["sort"], json!("newest"));
}

#[test]
fn rewrite_filter_paths_is_noop_without_key_or_with_bad_json() {
    let c = db();
    rewrite_filter_paths(&c, "工作", "职业").unwrap(); // 键缺失:无操作不报错
    assert_eq!(settings::get(&c, FILTER_CURRENT_KEY).unwrap(), None);

    settings::set(&c, FILTER_CURRENT_KEY, "不是 JSON").unwrap();
    rewrite_filter_paths(&c, "工作", "职业").unwrap();
    assert_eq!(settings::get(&c, FILTER_CURRENT_KEY).unwrap().unwrap(), "不是 JSON");

    // 标签页时代的旧多页形状:本模块不再理解,跳过、不失败、不自作修复
    let legacy = "{\"tabs\":\"不是数组\"}";
    settings::set(&c, FILTER_CURRENT_KEY, legacy).unwrap();
    rewrite_filter_paths(&c, "工作", "职业").unwrap();
    assert_eq!(settings::get(&c, FILTER_CURRENT_KEY).unwrap().unwrap(), legacy);
}
