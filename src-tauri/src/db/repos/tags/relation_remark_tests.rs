//! 线名存在名字点上的读数(v31 点/线 spec §6.4;原「属性名存在边上」迁移 023 的续):
//! `A --(名字)--> B` 的名字是线的 `name_id` 指向的纯名字点 `meta`,与 `B` 自己名字里的 md 备注无关。
//! 两件事必须分清:① 线指向一个名字点;② 目标标签名自己的 md 备注仍只驱动标签名的悬浮显示。
//! 写路径(`set_tag_relation` 按文本解析/建名字点)归 T3.2;本文件切读侧与新表。
use super::*;
use crate::db::repos::tags::tag_facts;
use crate::db::{migrate, repos};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    c
}

fn ensure(c: &Connection, path: &str) -> i64 {
    repos::tags::ensure_path(c, &[path.to_string()]).unwrap()
}

/// 线上名字点的文本(无名字线为空串)
fn line_name(c: &Connection, from: i64, to: i64) -> String {
    c.query_row(
        "SELECT COALESCE(n.meta,'') FROM lines l JOIN points s ON s.id = l.from_id
           JOIN points t ON t.id = l.to_id LEFT JOIN points n ON n.id = l.name_id
         WHERE (l.name_id IS NULL OR l.name_id <> 0) AND s.path IS NOT NULL
           AND l.from_id=?1 AND l.to_id=?2",
        rusqlite::params![from, to],
        |r| r.get(0),
    )
    .unwrap()
}

/// ① 写入的名字落在线指向的名字点上,逐标签读数原样返回
#[test]
fn set_relation_stores_name_on_the_line() {
    let mut c = db();
    let author = ensure(&c, "作者/丸尾常喜");
    let japan = ensure(&c, "地点轴/日本");
    set_tag_relation(&mut c, author, japan, "国籍").unwrap();

    assert_eq!(line_name(&c, author, japan), "国籍");
    let out = list_tag_relations(&c, author).unwrap();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].name_text, "国籍");
    assert!(out[0].name_id.is_some(), "非空名字必须带名字点 id");
    assert_eq!(out[0].name, "日本", "name 仍是目标末段名,名字文本另占 nameText");
    assert_eq!(out[0].path, "地点轴/日本");
}

/// ② 改名字只改线的 name_id,不增线(表达式唯一索引仍按 (from,to,名字) 去重)
#[test]
fn set_relation_updates_name_without_adding_lines() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    set_tag_relation(&mut c, a, b, "国籍").unwrap();
    set_tag_relation(&mut c, a, b, "出生地").unwrap();
    set_tag_relation(&mut c, a, b, "出生地").unwrap();

    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM lines l JOIN points s ON s.id = l.from_id JOIN points t ON t.id = l.to_id
             WHERE (l.name_id IS NULL OR l.name_id <> 0) AND s.path IS NOT NULL AND l.from_id=?1",
            rusqlite::params![a],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1, "同一对 (from,to) 只留一条线");
    assert_eq!(line_name(&c, a, b), "出生地");
    assert_eq!(list_tag_relations(&c, a).unwrap()[0].name_text, "出生地");
}

/// ③ 空名字合法(R12):线回无名字线,`nameId` 为 null、`nameText` 为空串
#[test]
fn empty_name_makes_an_unnamed_line() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    set_tag_relation(&mut c, a, b, "").unwrap();

    assert_eq!(line_name(&c, a, b), "");
    let out = list_tag_relations(&c, a).unwrap();
    assert_eq!(out[0].name_id, None, "空名字 = 无名字线");
    assert_eq!(out[0].name_text, "");
    // 先写名字再清空也走同一条 upsert
    set_tag_relation(&mut c, a, b, "国籍").unwrap();
    set_tag_relation(&mut c, a, b, "").unwrap();
    assert_eq!(list_tag_relations(&c, a).unwrap()[0].name_id, None);
}

/// ④ 名字来自名字点,**不**取目标标签名字里的 md 备注。
/// 判别力:把 relation_ref 改回读目标名的 md 备注(旧口径)时,本用例立刻红。
#[test]
fn name_comes_from_the_name_point_not_from_the_target_name() {
    let mut c = db();
    let author = ensure(&c, "作者/丸尾常喜");
    let japan = ensure(&c, "地点轴/[日本](日出之国)");
    set_tag_relation(&mut c, author, japan, "国籍").unwrap();

    let out = list_tag_relations(&c, author).unwrap();
    assert_eq!(out[0].name_text, "国籍", "名字点文本优先");
    assert_eq!(out[0].name, "[日本](日出之国)", "目标名原样返回,其 md 备注不参与关系显示");
}

/// ⑤ 批量事实与逐标签读数同一口径,都带名字文本
#[test]
fn tag_facts_carry_line_names() {
    let mut c = db();
    let author = ensure(&c, "作者/丸尾常喜");
    let japan = ensure(&c, "地点轴/日本");
    let china = ensure(&c, "地点轴/中国");
    set_tag_relation(&mut c, author, japan, "国籍").unwrap();
    set_tag_relation(&mut c, author, china, "出生地").unwrap();

    let facts = tag_facts(&c).unwrap();
    assert_eq!(facts.facts.len(), 1);
    assert_eq!(facts.facts[0].relations, list_tag_relations(&c, author).unwrap());
    let names: Vec<&str> =
        facts.facts[0].relations.iter().map(|r| r.name_text.as_str()).collect();
    assert_eq!(names, vec!["出生地", "国籍"], "按目标路径升序,各自带自己的名字");
}

/// ⑦ 合并标签时名字跟着线一起搬(`merge_edges::union_edges` 逐线带 name_id)
#[test]
fn merge_moves_line_name() {
    let mut c = db();
    let src = ensure(&c, "来源标签");
    let dst = ensure(&c, "目标标签");
    let japan = ensure(&c, "地点轴/日本");
    set_tag_relation(&mut c, src, japan, "国籍").unwrap();

    repos::tags::merge_tags(&mut c, src, dst, false).unwrap();

    assert_eq!(line_name(&c, dst, japan), "国籍", "合并后名字必须留在线上");
    assert_eq!(list_tag_relations(&c, dst).unwrap()[0].name_text, "国籍");
}

/// ⑥ 名字的变更不影响关系语义:入线计数不因名字改变
#[test]
fn line_name_does_not_change_relation_semantics() {
    let mut c = db();
    let author = ensure(&c, "作者/丸尾常喜");
    let japan = ensure(&c, "地点轴/日本");
    set_tag_relation(&mut c, author, japan, "国籍").unwrap();
    let before = count_relations_to(&c, japan).unwrap();
    set_tag_relation(&mut c, author, japan, "出生地").unwrap();

    assert_eq!(count_relations_to(&c, japan).unwrap(), before, "入线计数与名字无关");
    assert_eq!(list_tag_relations(&c, japan).unwrap().len(), 0, "名字不造出新线");
}
