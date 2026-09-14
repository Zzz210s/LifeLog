//! saved_views 条件级联测试(修复轮):改名/移动后视图条件路径跟随、
//! 删除子树后被删路径的条件项滤掉、坏 JSON 行不受影响。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes;
use crate::db::repos::notes::notes_filter::TagCond;
use crate::db::repos::tags_tree::{delete_subtree, move_to, rename};
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

fn cond(path: &str, include_children: bool) -> TagCond {
    TagCond { path: path.into(), include_children }
}

fn view_conds_json(c: &Connection, id: i64) -> String {
    c.query_row("SELECT conditions FROM saved_views WHERE id=?1", [id], |r| r.get(0))
        .unwrap()
}

/// 改名后:视图两侧条件按前缀规则跟随,徽标口径照常命中
#[test]
fn rename_cascades_saved_view_paths() {
    let mut c = db();
    notes::create(&mut c, "a #工作/项目A").unwrap();
    let vid = views::create(
        &c,
        "视图甲",
        &FilterConditions {
            tags: vec![cond("工作/项目A", true)],
            exclude_tags: vec![cond("工作", false)],
            ..Default::default()
        },
    )
    .unwrap();

    let work = id_at(&c, "工作");
    rename(&mut c, work, "事业").unwrap();

    let v = views::list(&c).unwrap();
    assert_eq!(v[0].conditions.tags[0].path, "事业/项目A");
    assert_eq!(v[0].conditions.tags[0].include_children, true);
    assert_eq!(v[0].conditions.exclude_tags[0].path, "事业");
    let hits = views::hit_counts(&c).unwrap();
    assert_eq!(
        hits.iter().find(|(k, _)| k == &format!("view:{vid}")).unwrap().1,
        1,
        "徽标口径跟随新路径"
    );
}

/// 移动后:视图条件路径整段前缀替换,其余字段(include_children 等)不动
#[test]
fn move_cascades_saved_view_paths() {
    let mut c = db();
    notes::create(&mut c, "a #工作/项目A").unwrap();
    notes::create(&mut c, "b #生活").unwrap();
    views::create(
        &c,
        "视图乙",
        &FilterConditions { tags: vec![cond("工作/项目A", false)], ..Default::default() },
    )
    .unwrap();

    let leaf = id_at(&c, "工作/项目A");
    let life = id_at(&c, "生活");
    move_to(&mut c, leaf, Some(life)).unwrap();

    let v = views::list(&c).unwrap();
    assert_eq!(v[0].conditions.tags[0].path, "生活/项目A");
    assert_eq!(v[0].conditions.tags[0].include_children, false);
}

/// 删除子树后:被删子树内的条件项(含比真实标签更深的失效路径)直接滤掉,
/// 其余条件项保留 —— 视图变成少了那个条件,不是坏视图
#[test]
fn delete_subtree_drops_deleted_conditions() {
    let mut c = db();
    notes::create(&mut c, "a #工作/项目A").unwrap();
    notes::create(&mut c, "b #todo").unwrap();
    views::create(
        &c,
        "视图丙",
        &FilterConditions {
            tags: vec![cond("工作/项目A", true), cond("todo", false), cond("工作/幽灵/深层", true)],
            exclude_tags: vec![cond("工作", true)],
            ..Default::default()
        },
    )
    .unwrap();

    let work = id_at(&c, "工作");
    delete_subtree(&mut c, work).unwrap();

    let v = views::list(&c).unwrap();
    let paths: Vec<&str> = v[0].conditions.tags.iter().map(|t| t.path.as_str()).collect();
    assert_eq!(paths, vec!["todo"], "被删子树(含更深的失效路径)滤掉,其余保留");
    assert!(v[0].conditions.exclude_tags.is_empty());
}

/// 坏 JSON 行:级联时跳过(不动、不失败),整条 rename 照常成功
#[test]
fn bad_json_row_untouched_by_cascade() {
    let mut c = db();
    notes::create(&mut c, "a #工作").unwrap();
    c.execute(
        "INSERT INTO saved_views(title, conditions, sort_order, created_at)
         VALUES('坏行', '{bad json', 0, datetime('now','localtime'))",
        [],
    )
    .unwrap();
    let before = view_conds_json(&c, 1);

    let work = id_at(&c, "工作");
    rename(&mut c, work, "事业").unwrap();

    assert_eq!(view_conds_json(&c, 1), before, "坏 JSON 行原样不动");
}

/// 纯函数:前缀改写与子树归属判定
#[test]
fn rewrite_path_and_under_root_semantics() {
    assert_eq!(rewrite_path("工作", "工作", "事业"), Some("事业".into()));
    assert_eq!(rewrite_path("工作/项目A", "工作", "事业"), Some("事业/项目A".into()));
    assert_eq!(rewrite_path("工作X", "工作", "事业"), None, "前缀必须落在段边界上");
    assert_eq!(rewrite_path("别的工作", "工作", "事业"), None);
    assert!(under_root("工作", "工作"));
    assert!(under_root("工作/项目A/会议", "工作"));
    assert!(!under_root("工作X", "工作"));
    assert!(!under_root("别的工作", "工作"));
}
