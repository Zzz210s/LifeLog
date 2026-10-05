//! 批量标签事实(`tag_facts`,spec 2026-10-05-tag-types §5)测试:一次取全、
//! 认领与携带两路合并、无事实的标签不出现、历史未登记携带目标照样读得到。
use super::*;
use crate::db::repos::tags::{set_tag_type_flag, set_carry, set_tag_types};
use crate::db::{migrate, repos};
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    c
}

fn ensure(c: &Connection, path: &str) -> i64 {
    repos::tags::ensure_path(c, &[path.to_string()]).unwrap()
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", params![path], |r| r.get(0))
        .unwrap()
}

/// ① 一次返回全量:一个标签同时有类型与携带时两路合并进同一条事实;
/// 既无类型也无携带的标签不出现;bundle.types 给出完整类型表
#[test]
fn facts_merge_roles_and_carried_per_tag() {
    let mut c = db();
    let guo = ensure(&c, "地点轴/国籍");
    let suo = ensure(&c, "地点轴/所在");
    let zhong = ensure(&c, "中国");
    set_tag_type_flag(&c, guo, true).unwrap();
    set_tag_type_flag(&c, suo, true).unwrap();
    set_tag_types(&mut c, zhong, vec![guo, suo]).unwrap();
    set_carry(&mut c, zhong, guo).unwrap(); // R3:目标是已登记的 国籍
    ensure(&c, "无关标签");

    let bundle = tag_facts(&c).unwrap();
    assert_eq!(bundle.types.len(), 2, "类型表给全库登记类型");
    assert_eq!(bundle.facts.len(), 1, "只有 中国 有事实");
    let f = &bundle.facts[0];
    assert_eq!(f.tag_id, zhong);
    assert_eq!(f.types.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), vec!["地点轴/国籍", "地点轴/所在"]);
    assert_eq!(f.carried, vec!["地点轴/国籍".to_string()]);
}

/// ② 携带目标未登记(历史行,R8 豁免)也照样出现在事实里;空库给空包
#[test]
fn facts_keep_legacy_carried_targets() {
    let c = db();
    let author = ensure(&c, "作者/丸尾");
    let legacy = ensure(&c, "老类型");
    c.execute(
        "INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'tag', ?2)",
        params![author, legacy],
    )
    .unwrap();

    let bundle = tag_facts(&c).unwrap();
    assert!(bundle.types.is_empty(), "没有登记类型");
    assert_eq!(bundle.facts.len(), 1);
    assert_eq!(bundle.facts[0].carried, vec!["老类型".to_string()], "历史行不被过滤");

    let empty = db();
    assert_eq!(tag_facts(&empty).unwrap(), TagFactsBundle { types: vec![], facts: vec![] });
}

/// ③ 事实按 tag_id 升序;删除标签后它的认领/携带事实随之消失(级联)
#[test]
fn facts_are_sorted_and_follow_cascades() {
    let mut c = db();
    let guo = ensure(&c, "国籍");
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    set_tag_type_flag(&c, guo, true).unwrap();
    set_tag_types(&mut c, b, vec![guo]).unwrap();
    set_tag_types(&mut c, a, vec![guo]).unwrap();

    let ids: Vec<i64> = tag_facts(&c).unwrap().facts.iter().map(|f| f.tag_id).collect();
    assert!(ids.windows(2).all(|w| w[0] < w[1]), "按 tag_id 升序: {ids:?}");

    let a_id = id_at(&c, "甲");
    repos::tags::delete_subtree(&mut c, a_id).unwrap();
    let after: Vec<i64> = tag_facts(&c).unwrap().facts.iter().map(|f| f.tag_id).collect();
    assert_eq!(after, vec![b], "被删标签的事实消失");
}
