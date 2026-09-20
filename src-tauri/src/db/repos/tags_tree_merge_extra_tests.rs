//! 标签合并补充测试(核心用例见 tags_tree_merge_tests.rs):
//! FTS 标签列改写、标签页条件级联(D7)、孤儿容器回收。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::{self, notes_filter::*, query};
use crate::db::repos::settings::{self, TABS_STATE_KEY};
use crate::db::repos::tags_invariants_tests::{
    assert_fts_matches_tags, assert_no_orphan_tags, assert_tabs_paths_exist,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0))
        .unwrap()
}

/// 笔记在 FTS 里的标签列(聚合路径,空格分隔)
fn fts_tags(c: &Connection, note_id: i64) -> String {
    c.query_row("SELECT tags FROM notes_fts WHERE rowid=?1", params![note_id], |r| {
        r.get(0)
    })
    .unwrap()
}

/// 关键词检索命中数(≥3 字符走 FTS 分支;内容里的 #标签 已在入库时剥离)
fn hits(c: &Connection, kw: &str) -> usize {
    query(c, &FilterConditions { keyword: Some(kw.into()), ..empty() }, 0)
        .unwrap()
        .len()
}

/// ⑨ FTS:合并后标签列改成目标路径,按源路径检索不再命中
#[test]
fn merge_rewrites_fts_tag_column() {
    let mut c = db();
    let only_src = notes::create_plain(&mut c, "甲 #工作/项目A").unwrap();
    let both = notes::create_plain(&mut c, "乙 #工作/项目A #职业生涯").unwrap();
    let (src, dst) = (id_at(&c, "工作/项目A"), id_at(&c, "职业生涯"));

    merge_tags(&mut c, src, dst, false).unwrap();

    assert_eq!(fts_tags(&c, only_src.id), "职业生涯");
    assert_eq!(fts_tags(&c, both.id), "职业生涯", "两处链接合成一条,标签列不重复");
    assert_eq!(hits(&c, "职业生涯"), 2);
    assert_eq!(hits(&c, "工作/项目A"), 0, "源路径已从 FTS 消失");
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// ⑩ 级联(D7):tabs_state 的 tags[] / excludeTags[] / expr token 改写成目标路径,其余字段原样
#[test]
fn merge_rewrites_tab_conditions_and_expr_tokens() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作/项目A").unwrap();
    notes::create_plain(&mut c, "b #事业").unwrap();
    let (src, dst) = (id_at(&c, "工作/项目A"), id_at(&c, "事业"));
    let seeded = json!({
        "tabs": [{
            "title": "页",
            "conditions": {
                "keyword": null,
                "tags": [{"path": "工作/项目A", "includeChildren": true}],
                "excludeTags": [{"path": "工作/项目A", "includeChildren": false}],
                "tagPresence": null,
                "sort": "newest",
                "expr": "#工作/项目A AND NOT #=工作/项目A"
            }
        }],
        "activeIndex": 0
    });
    settings::set(&c, TABS_STATE_KEY, &seeded.to_string()).unwrap();

    merge_tags(&mut c, src, dst, false).unwrap();

    let raw = settings::get(&c, TABS_STATE_KEY).unwrap().unwrap();
    let root: Value = serde_json::from_str(&raw).unwrap();
    let conds = &root["tabs"][0]["conditions"];
    assert_eq!(conds["tags"][0]["path"], "事业");
    assert_eq!(conds["excludeTags"][0]["path"], "事业");
    assert_eq!(conds["expr"], "#事业 AND NOT #=事业");
    assert_eq!(conds["tags"][0]["includeChildren"], true, "其余条件字段原样保留");
    assert_eq!(root["tabs"][0]["title"], "页");
    assert_eq!(root["activeIndex"], 0);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
    assert_tabs_paths_exist(&c);
}

/// ⑪ 孤儿回收:源是父容器的唯一子节点 -> 合并后父容器也消失(整条空链回收到根)
#[test]
fn merge_gcs_emptied_parent_container() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作/项目A").unwrap();
    notes::create_plain(&mut c, "b #事业").unwrap();
    let (src, dst) = (id_at(&c, "工作/项目A"), id_at(&c, "事业"));

    merge_tags(&mut c, src, dst, false).unwrap();

    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tags WHERE path IN ('工作','工作/项目A')"),
        0,
        "源与它变空的父容器一并回收"
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='事业'"), 1);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// 回归(当初漏掉的那条):合并后不变量①必须成立 —— FTS 标签列与 tag_links 聚合逐笔记一致。
/// 另附②③:源的父容器被回收、tabs_state 引用的路径在级联后真实存在。
#[test]
fn merge_keeps_all_tag_invariants() {
    let mut c = db();
    notes::create_plain(&mut c, "甲 #工作/项目A").unwrap();
    notes::create_plain(&mut c, "乙 #工作/项目A #职业生涯").unwrap();
    notes::create_plain(&mut c, "丙 #职业生涯").unwrap();
    let seeded = json!({
        "tabs": [{
            "title": "页",
            "conditions": {
                "tags": [{"path": "工作/项目A", "includeChildren": true}],
                "excludeTags": [],
                "expr": "#工作/项目A"
            }
        }],
        "activeIndex": 0
    });
    settings::set(&c, TABS_STATE_KEY, &seeded.to_string()).unwrap();
    let (src, dst) = (id_at(&c, "工作/项目A"), id_at(&c, "职业生涯"));

    merge_tags(&mut c, src, dst, true).unwrap();

    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
    assert_tabs_paths_exist(&c);
}
