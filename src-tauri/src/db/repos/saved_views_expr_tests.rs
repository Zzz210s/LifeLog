//! Task 4 测试:表达式 token 的文本级重写(前缀规则与结构化条件同一套)、引用路径列举、
//! 与结构化条件同一事务的端到端级联、删除标签后的失效路径标记(文本不改)。
//! 既有结构化条件断言在 saved_views_rewrite_tests.rs 中保持逐字不动,故本文件单独承载新用例。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes;
use crate::db::repos::notes::notes_filter::TagCond;
use crate::db::repos::tags_tree::{delete_subtree, rename};
use crate::db::repos::views;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0))
        .unwrap()
}

/// 唯一自建视图的表达式文本(经 list 读,走真实 DTO)
fn expr_of(c: &Connection) -> Option<String> {
    views::list(c).unwrap()[0].conditions.expr.clone()
}

/// 校验:库中该视图的 conditions JSON 里 expr 字段已按新路径落库
fn stored_expr(c: &Connection) -> String {
    c.query_row("SELECT conditions FROM saved_views WHERE id=1", [], |r| r.get(0))
        .unwrap()
}

#[test]
fn rewrite_expr_paths_follows_prefix_rule() {
    assert_eq!(
        rewrite_expr_paths("#=工作/项目A AND NOT #工作2", "工作/项目A", "工作/项目X"),
        "#=工作/项目X AND NOT #工作2"
    );
    assert_eq!(rewrite_expr_paths("#工作 AND #工作/项目A", "工作", "职业"), "#职业 AND #职业/项目A");
    assert_eq!(rewrite_expr_paths("复盘 AND #工作", "工作", "职业"), "复盘 AND #职业");
}

/// 同一路径多次出现全改;未引用的路径不改;引号短语里的 `#` 不是标签,不得误改
#[test]
fn rewrite_expr_paths_keeps_other_tokens_verbatim() {
    assert_eq!(rewrite_expr_paths("#a OR (#a AND NOT #a)", "a", "b"), "#b OR (#b AND NOT #b)");
    let untouched = "#其他 AND 复盘";
    assert_eq!(rewrite_expr_paths(untouched, "工作", "职业"), untouched, "文本逐字保留");
    assert_eq!(
        rewrite_expr_paths("#a AND \"含 #a 的短语\"", "a", "b"),
        "#b AND \"含 #a 的短语\""
    );
    // 仅本级标记 `#=` 要保留:`#=a` 改 a -> b 后仍是仅本级
    assert_eq!(rewrite_expr_paths("#=a", "a", "b"), "#=b");
}

#[test]
fn expr_paths_lists_referenced_tags_in_order() {
    assert_eq!(expr_paths("#a AND NOT #=b AND #a"), vec!["a".to_string(), "b".to_string()]);
    assert_eq!(expr_paths("非法 ((( 表达式"), Vec::<String>::new()); // 无标签 -> 空
    assert_eq!(expr_paths("#工作/项目A OR 复盘"), vec!["工作/项目A".to_string()]);
    // 词法失败(引号未闭合):返回空,不 panic
    assert_eq!(expr_paths("#a AND \"未闭合"), Vec::<String>::new());
    assert_eq!(rewrite_expr_paths("#a AND \"未闭合", "a", "b"), "#a AND \"未闭合", "失败时原文不动");
}

/// 端到端:表达式里的路径与结构化条件在同一事务里被改写,库里 JSON 已换新路径
#[test]
fn cascade_rewrites_expression_in_saved_views() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作/项目A").unwrap();
    views::create(
        &c,
        "视图丁",
        &FilterConditions {
            tags: vec![TagCond { path: "工作/项目A".into(), include_children: true }],
            expr: Some("#工作/项目A AND 复盘".into()),
            ..Default::default()
        },
    )
    .unwrap();

    let leaf = id_at(&c, "工作/项目A");
    rename(&mut c, leaf, "项目X").unwrap();

    assert_eq!(expr_of(&c).as_deref(), Some("#工作/项目X AND 复盘"));
    assert!(stored_expr(&c).contains("#工作/项目X AND 复盘"), "已回写库里");
    let v = views::list(&c).unwrap();
    assert_eq!(v[0].conditions.tags[0].path, "工作/项目X", "结构化条件照旧跟随");
}

/// 端到端(根级改名):`#临时` -> `#临时2`,其余文字(空格、关键词)原样
#[test]
fn cascade_rewrites_root_level_expression_path() {
    let mut c = db();
    notes::create_plain(&mut c, "a #临时").unwrap();
    views::create(
        &c,
        "视图己",
        &FilterConditions { expr: Some("#临时 AND 复盘".into()), ..Default::default() },
    )
    .unwrap();

    let root = id_at(&c, "临时");
    rename(&mut c, root, "临时2").unwrap();

    assert_eq!(expr_of(&c).as_deref(), Some("#临时2 AND 复盘"));
}

/// 删除标签:表达式文本不动(不像结构化条件那样被滤掉),只在 DTO 里报告失效路径
#[test]
fn delete_tag_keeps_expression_text_but_flags_broken_path() {
    let mut c = db();
    notes::create_plain(&mut c, "a #临时").unwrap();
    notes::create_plain(&mut c, "b #工作").unwrap();
    views::create(
        &c,
        "视图庚",
        &FilterConditions { expr: Some("#临时 AND #工作".into()), ..Default::default() },
    )
    .unwrap();
    assert!(views::list(&c).unwrap()[0].broken_paths.is_empty(), "删除前都在库中");

    let temp = id_at(&c, "临时");
    delete_subtree(&mut c, temp).unwrap();

    let v = views::list(&c).unwrap();
    assert_eq!(v[0].conditions.expr.as_deref(), Some("#临时 AND #工作"), "文本不变");
    assert_eq!(v[0].broken_paths, vec!["临时".to_string()]);
}

/// 更深的失效路径(父级存在、自身不在库中)同样算失效,顺序按出现次序
#[test]
fn broken_paths_flag_missing_deeper_path() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作").unwrap();
    views::create(
        &c,
        "视图辛",
        &FilterConditions { expr: Some("#工作/幽灵 AND #工作".into()), ..Default::default() },
    )
    .unwrap();

    assert_eq!(views::list(&c).unwrap()[0].broken_paths, vec!["工作/幽灵".to_string()]);
}

/// 无表达式 / 表达式引用的标签都存在时:broken_paths 为空数组(不是 null)
#[test]
fn broken_paths_empty_for_valid_or_absent_expression() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作").unwrap();
    views::create(&c, "无表达式", &FilterConditions::default()).unwrap();
    views::create(
        &c,
        "有表达式",
        &FilterConditions { expr: Some("#工作 AND 复盘".into()), ..Default::default() },
    )
    .unwrap();

    let all = views::list(&c).unwrap();
    assert!(all[0].broken_paths.is_empty());
    assert!(all[1].broken_paths.is_empty(), "引用存在的标签 -> 无失效");
}
