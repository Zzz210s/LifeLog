//! 条件栏命中数(`notes_hits`)测试:与 query_notes 逐值同源(单条件 / 单组),
//! 覆盖含子级 / 仅本级、携带继承、类型认领继承与排除侧;OR 组只给组级读数。
use super::*;
use crate::db::repos::notes;
use crate::db::repos::notes::notes_filter::{RelationCond, TagCond};
use crate::db::repos::notes::notes_filter_groups::{FilterGroup, GroupItem};
use crate::db::repos::tags::set_tag_relation;
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
fn role_cond(path: &str) -> RelationCond {
    RelationCond { path: path.into() }
}

/// 单条件查询的真实条数(同一条件走 query_notes),与 hits 读数逐值比对
fn q(c: &Connection, cond: &FilterConditions) -> i64 {
    notes::query(c, cond, 0).unwrap().len() as i64
}

/// ① 标签条件:含子级 = 子树,仅本级 = 单层;逐项读数与 query_notes 一致
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

    // 平铺字段经归一搬进 groups[0],逐项读数与 items 同序
    assert_eq!(hits.groups.len(), 1);
    assert_eq!(hits.groups[0].op, "and");
    assert_eq!(hits.groups[0].item_hits[0], q(&c, &sub));
    assert_eq!(hits.groups[0].item_hits[1], q(&c, &self_only));
    assert_eq!(hits.groups[0].item_hits, vec![2, 1, 1, 1], "含子级 2、仅本级 1、乙 1、排除乙 1");
    assert_eq!(hits.groups[0].group_hit, None, "AND 组不给组级读数");
}

/// ② 类型条件 = 被认领标签子树 ∪ 经携带命中;排除侧同数;与 query_notes 一致
#[test]
fn relation_hits_match_query_with_claims_and_carry() {
    let mut c = db();
    notes::create_plain(&mut c, "甲笔记 #甲").unwrap();
    notes::create_plain(&mut c, "甲子笔记 #甲/子").unwrap();
    notes::create_plain(&mut c, "乙笔记 #乙").unwrap();
    let jia = tag(&c, &["甲"]);
    tag(&c, &["甲", "子"]);
    let yi = tag(&c, &["乙"]);
    let guo = tag(&c, &["国籍"]);
    set_tag_relation(&mut c, jia, guo, "").unwrap(); // 甲 携带 国籍 → 甲 子树经携带命中
    set_tag_relation(&mut c, yi, guo, "").unwrap(); // 乙 被 国籍 认领 → 乙 子树命中

    let cond = FilterConditions { relations: vec![role_cond("国籍")], ..Default::default() };
    let hits = hits(&c, &FilterConditions {
        relations: vec![role_cond("国籍")],
        exclude_relations: vec![role_cond("国籍")],
        ..Default::default()
    })
    .unwrap();

    assert_eq!(hits.groups[0].item_hits, vec![q(&c, &cond), q(&c, &cond)]);
    assert_eq!(hits.groups[0].item_hits, vec![3, 3], "认领(乙)1 + 携带(甲子树)2;排除侧同一份命中集");
}

/// ③ OR 组:逐项读数不显示(空向量),只给整组命中数 = 组谓词 COUNT
#[test]
fn or_group_gives_group_level_count_only() {
    let mut c = db();
    notes::create_plain(&mut c, "甲笔记 #甲").unwrap();
    notes::create_plain(&mut c, "甲子笔记 #甲/子").unwrap();
    notes::create_plain(&mut c, "乙笔记 #乙").unwrap();
    tag(&c, &["甲"]);
    tag(&c, &["甲", "子"]);
    tag(&c, &["乙"]);
    let cond = FilterConditions {
        groups: vec![FilterGroup {
            op: "or".into(),
            items: vec![
                GroupItem::Tag { path: "甲".into(), include_children: true },
                GroupItem::Tag { path: "乙".into(), include_children: true },
            ],
        }],
        ..Default::default()
    };
    let hits = hits(&c, &cond).unwrap();
    assert!(hits.groups[0].item_hits.is_empty(), "OR 组不给逐项读数");
    assert_eq!(hits.groups[0].group_hit, Some(3));
    // 组级读数 == 整组查询的真实条数(3 条都在结果的首页)
    assert_eq!(hits.groups[0].group_hit, Some(q(&c, &cond)));
}

/// ④ 空条件不给查询:没有任何组读数
#[test]
fn empty_conditions_yield_empty_hits() {
    let c = db();
    assert_eq!(hits(&c, &FilterConditions::default()).unwrap(), ConditionHits::default());
}
