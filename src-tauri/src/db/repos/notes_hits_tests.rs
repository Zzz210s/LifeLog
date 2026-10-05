//! 条件栏命中数(`notes_hits`)测试:与 query_notes 逐值同源(单条件),
//! 覆盖含子级 / 仅本级、携带继承、角色认领继承与排除侧。
use super::*;
use crate::db::repos::notes::notes_filter::{RoleCond, TagCond};
use crate::db::repos::notes;
use crate::db::repos::tags::{register_role, set_carry, set_tag_roles};
use crate::db::{migrate, repos};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    c
}

fn tag(c: &Connection, segs: &[&str]) -> i64 {
    repos::tags::ensure_path(c, &segs.iter().map(|s| s.to_string()).collect::<Vec<_>>()).unwrap()
}

fn tag_cond(path: &str, include_children: bool) -> TagCond {
    TagCond { path: path.into(), include_children }
}
fn role_cond(path: &str) -> RoleCond {
    RoleCond { path: path.into() }
}

/// 单条件查询的真实条数(同一条件走 query_notes),与 hits 读数逐值比对
fn q(c: &Connection, cond: &FilterConditions) -> i64 {
    notes::query(c, cond, 0).unwrap().len() as i64
}

/// ① 标签条件:含子级 = 子树,仅本级 = 单层;读数与 query_notes 一致
#[test]
fn tag_hits_match_query_for_subtree_and_self_only() {
    let mut c = db();
    notes::create_plain(&mut c, "甲笔记 #甲").unwrap();
    notes::create_plain(&mut c, "甲子笔记 #甲/子").unwrap();
    notes::create_plain(&mut c, "乙笔记 #乙").unwrap();
    tag(&c, &["甲"]);
    tag(&c, &["甲", "子"]);
    tag(&c, &["乙"]);

    let sub = FilterConditions { tags: vec![tag_cond("甲", true)], ..Default::default() };
    let self_only = FilterConditions { tags: vec![tag_cond("甲", false)], ..Default::default() };
    let hits = hits(&c, &FilterConditions {
        tags: vec![tag_cond("甲", true), tag_cond("甲", false), tag_cond("乙", true)],
        exclude_tags: vec![tag_cond("乙", true)],
        ..Default::default()
    })
    .unwrap();

    assert_eq!(hits.tag_hits, vec![q(&c, &sub), q(&c, &self_only), 1]);
    assert_eq!(hits.tag_hits, vec![2, 1, 1], "含子级 2、仅本级 1、乙 1");
    assert_eq!(hits.exclude_tag_hits, vec![1], "排除侧计的就是该条件自己的命中集");
}

/// ② 角色条件 = 被认领标签子树 ∪ 经携带命中;排除侧同数;与 query_notes 一致
#[test]
fn role_hits_match_query_with_claims_and_carry() {
    let mut c = db();
    notes::create_plain(&mut c, "甲笔记 #甲").unwrap();
    notes::create_plain(&mut c, "甲子笔记 #甲/子").unwrap();
    notes::create_plain(&mut c, "乙笔记 #乙").unwrap();
    let jia = tag(&c, &["甲"]);
    tag(&c, &["甲", "子"]);
    let yi = tag(&c, &["乙"]);
    let guo = tag(&c, &["国籍"]);
    register_role(&c, guo).unwrap();
    set_carry(&mut c, jia, guo).unwrap(); // 甲 携带 国籍 → 甲 子树经携带命中
    set_tag_roles(&mut c, yi, vec![guo]).unwrap(); // 乙 被 国籍 认领 → 乙 子树命中

    let cond = FilterConditions { roles: vec![role_cond("国籍")], ..Default::default() };
    let hits = hits(&c, &FilterConditions {
        roles: vec![role_cond("国籍")],
        exclude_roles: vec![role_cond("国籍")],
        ..Default::default()
    })
    .unwrap();

    assert_eq!(hits.role_hits, vec![q(&c, &cond)]);
    assert_eq!(hits.role_hits, vec![3], "认领(乙)1 + 携带(甲子树)2");
    assert_eq!(hits.exclude_role_hits, hits.role_hits, "排除 chip 显示的是该条件自己影响到的条数");
}

/// ③ 空条件不给查询:四组读数都是空向量
#[test]
fn empty_conditions_yield_empty_hits() {
    let c = db();
    assert_eq!(hits(&c, &FilterConditions::default()).unwrap(), ConditionHits::default());
}
