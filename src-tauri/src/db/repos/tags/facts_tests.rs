//! 批量标签关系事实(`tag_facts`,设计 2026-10-06 §7)测试:一次取全、
//! 出边按目标路径升序、无关系的标签不出现、删除后事实随之消失。
use super::*;
use crate::db::repos::tags::set_tag_relation;
use crate::db::{migrate, repos};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    crate::db::repos::tags::test_support::install_legacy_name_views(&c);
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    c
}

fn ensure(c: &Connection, path: &str) -> i64 {
    repos::tags::ensure_path(c, &[path.to_string()]).unwrap()
}

/// ① 一次返回全量:同一标签的多条出边合并进同一条事实,按目标路径升序;
/// 没有关系的标签不出现
#[test]
fn facts_group_relations_per_tag_sorted_by_path() {
    let mut c = db();
    let zhong = ensure(&c, "中国");
    let guo = ensure(&c, "地点轴/国籍");
    let suo = ensure(&c, "地点轴/所在");
    set_tag_relation(&mut c, zhong, guo, "").unwrap();
    set_tag_relation(&mut c, zhong, suo, "").unwrap();
    ensure(&c, "无关标签");

    let bundle = tag_facts(&c).unwrap();
    assert_eq!(bundle.facts.len(), 1, "只有 中国 有关系");
    let f = &bundle.facts[0];
    assert_eq!(f.tag_id, zhong);
    let paths: Vec<&str> = f.relations.iter().map(|r| r.path.as_str()).collect();
    assert_eq!(paths, vec!["地点轴/国籍", "地点轴/所在"], "按目标路径升序");
}

/// ② 空库给空包
#[test]
fn facts_empty_on_fresh_db() {
    let c = db();
    assert_eq!(tag_facts(&c).unwrap(), TagFactsBundle { facts: vec![] });
}

/// ③ 事实按 tag_id 升序;删除标签后它的出边事实随之消失(外键级联)
#[test]
fn facts_sorted_and_follow_cascades() {
    let mut c = db();
    let guo = ensure(&c, "国籍");
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    set_tag_relation(&mut c, b, guo, "").unwrap();
    set_tag_relation(&mut c, a, guo, "").unwrap();

    let ids: Vec<i64> = tag_facts(&c).unwrap().facts.iter().map(|f| f.tag_id).collect();
    assert!(ids.windows(2).all(|w| w[0] < w[1]), "按 tag_id 升序: {ids:?}");

    repos::tags::delete_subtree(&mut c, a).unwrap();
    let after: Vec<i64> = tag_facts(&c).unwrap().facts.iter().map(|f| f.tag_id).collect();
    assert_eq!(after, vec![b], "被删标签的事实消失");
}
