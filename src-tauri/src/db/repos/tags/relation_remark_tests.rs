//! 属性名存在**边**上的读数(设计 2026-10-06 §2 修订,迁移 023):
//! `A --(属性名)--> B` 的属性名是 `tag_links.remark`,与 `B` 自己名字里的 md 备注无关。
//! 两件事必须分清:① 边上写明属性名;② 目标标签名自己的 md 备注仍只驱动标签名的悬浮显示。
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

fn edge_remark(c: &Connection, from: i64, to: i64) -> String {
    c.query_row(
        "SELECT e.remark FROM edges e JOIN entities s ON s.id = e.source_id JOIN entities t ON t.id = e.target_id WHERE e.kind = 'link' AND s.path IS NOT NULL AND e.source_id=?1 AND e.target_id=?2",
        rusqlite::params![from, to],
        |r| r.get(0),
    )
    .unwrap()
}

/// ① 写入的属性名落在边上,逐标签读数原样返回
#[test]
fn set_relation_stores_remark_on_the_edge() {
    let mut c = db();
    let author = ensure(&c, "作者/丸尾常喜");
    let japan = ensure(&c, "地点轴/日本");
    set_tag_relation(&mut c, author, japan, "国籍").unwrap();

    assert_eq!(edge_remark(&c, author, japan), "国籍");
    let out = list_tag_relations(&c, author).unwrap();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].remark, "国籍");
    assert_eq!(out[0].name, "日本", "name 仍是目标末段名,属性名另占 remark");
    assert_eq!(out[0].path, "地点轴/日本");
}

/// ② upsert:同一条边换属性名只改这一行,不增行(边的主键仍去重)
#[test]
fn set_relation_updates_remark_idempotently() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    set_tag_relation(&mut c, a, b, "国籍").unwrap();
    set_tag_relation(&mut c, a, b, "出生地").unwrap();
    set_tag_relation(&mut c, a, b, "出生地").unwrap();

    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM edges e JOIN entities s ON s.id = e.source_id JOIN entities t ON t.id = e.target_id WHERE e.kind = 'link' AND s.path IS NOT NULL AND e.source_id=?1",
            rusqlite::params![a],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1, "重复写入不得增行");
    assert_eq!(edge_remark(&c, a, b), "出生地");
    assert_eq!(list_tag_relations(&c, a).unwrap()[0].remark, "出生地");
}

/// ③ 空属性名合法(R12):边照样建立,remark 为空串,显示时回退只给目标名
#[test]
fn empty_remark_is_allowed_and_stored_as_empty() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    set_tag_relation(&mut c, a, b, "").unwrap();

    assert_eq!(edge_remark(&c, a, b), "");
    assert_eq!(list_tag_relations(&c, a).unwrap()[0].remark, "");
    // 先写属性名再清空也走同一条 upsert
    set_tag_relation(&mut c, a, b, "国籍").unwrap();
    set_tag_relation(&mut c, a, b, "").unwrap();
    assert_eq!(edge_remark(&c, a, b), "");
}

/// ④ 属性名来自边,**不**取目标标签名字里的 md 备注。
/// 判别力:把 relation_ref 改回读目标名的 md 备注(旧口径)时,本用例立刻红 ——
/// 目标名写着 `[日本](日出之国)`,边上属性名是「国籍」,读回来必须是「国籍」。
#[test]
fn remark_comes_from_the_edge_not_from_the_target_name() {
    let mut c = db();
    let author = ensure(&c, "作者/丸尾常喜");
    let japan = ensure(&c, "地点轴/[日本](日出之国)");
    set_tag_relation(&mut c, author, japan, "国籍").unwrap();

    let out = list_tag_relations(&c, author).unwrap();
    assert_eq!(out[0].remark, "国籍", "边上的属性名优先");
    assert_eq!(out[0].name, "[日本](日出之国)", "目标名原样返回,其 md 备注不参与关系显示");
}

/// ⑤ 批量事实与逐标签读数同一口径,都带边上的属性名
#[test]
fn tag_facts_carry_edge_remark() {
    let mut c = db();
    let author = ensure(&c, "作者/丸尾常喜");
    let japan = ensure(&c, "地点轴/日本");
    let china = ensure(&c, "地点轴/中国");
    set_tag_relation(&mut c, author, japan, "国籍").unwrap();
    set_tag_relation(&mut c, author, china, "出生地").unwrap();

    let facts = tag_facts(&c).unwrap();
    assert_eq!(facts.facts.len(), 1);
    assert_eq!(facts.facts[0].relations, list_tag_relations(&c, author).unwrap());
    let remarks: Vec<&str> = facts.facts[0].relations.iter().map(|r| r.remark.as_str()).collect();
    assert_eq!(remarks, vec!["出生地", "国籍"], "按目标路径升序,各自带自己的属性名");
}

/// ⑦ 合并标签时属性名跟着边一起搬(`merge_edges::union_edges` 逐边带 remark)
#[test]
fn merge_moves_edge_remark() {
    let mut c = db();
    let src = ensure(&c, "来源标签");
    let dst = ensure(&c, "目标标签");
    let japan = ensure(&c, "地点轴/日本");
    set_tag_relation(&mut c, src, japan, "国籍").unwrap();

    repos::tags::merge_tags(&mut c, src, dst, false).unwrap();

    assert_eq!(edge_remark(&c, dst, japan), "国籍", "合并后属性名必须留在边上");
    assert_eq!(list_tag_relations(&c, dst).unwrap()[0].remark, "国籍");
}

/// ⑥ 属性名的变更不影响关系语义:筛选命中数不因 remark 改变
#[test]
fn remark_does_not_change_relation_semantics() {
    let mut c = db();
    let author = ensure(&c, "作者/丸尾常喜");
    let japan = ensure(&c, "地点轴/日本");
    set_tag_relation(&mut c, author, japan, "国籍").unwrap();
    let before = count_relations_to(&c, japan).unwrap();
    set_tag_relation(&mut c, author, japan, "出生地").unwrap();

    assert_eq!(count_relations_to(&c, japan).unwrap(), before, "入边计数与属性名无关");
    assert_eq!(list_tag_relations(&c, japan).unwrap().len(), 0, "属性名不造出新边");
}
