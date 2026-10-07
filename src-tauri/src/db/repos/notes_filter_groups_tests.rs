//! 条件组语义验收(设计 2026-10-06 §5):组内 / 组间 op 的 SQL 语义、空组丢弃、
//! 与手写表达式逐值等价、括号正确、非法 op 被 validate 拦下。
use crate::db::migrate;
use crate::db::repos::notes::notes_filter::{validate, where_clause, FilterConditions, FilterGroup, TagCond};
use crate::db::repos::notes::notes_filter_groups::GroupItem;
use crate::db::repos::notes::{create_plain, query};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn tag(path: &str) -> GroupItem {
    GroupItem::Tag { path: path.into(), include_children: true }
}
fn grp(op: &str, items: Vec<GroupItem>) -> FilterGroup {
    FilterGroup { op: op.into(), items }
}
fn contents(notes: &[crate::db::repos::notes::Note]) -> Vec<String> {
    notes.iter().map(|n| n.content.clone()).collect()
}

/// ① `(甲 or 乙) and 丙` 的命中集与手写表达式 `(#甲 OR #乙) AND #丙` 逐值相同
#[test]
fn and_or_group_matches_handwritten_expression() {
    let mut c = db();
    for src in ["甲笔记 #甲", "乙笔记 #乙", "丙笔记 #丙", "甲乙 #甲 #乙", "甲丙 #甲 #丙", "乙丙 #乙 #丙"] {
        create_plain(&mut c, src).unwrap();
    }
    let grouped = FilterConditions {
        groups: vec![grp("or", vec![tag("甲"), tag("乙")]), grp("and", vec![tag("丙")])],
        ..Default::default()
    };
    let expr = FilterConditions { expr: Some("(#甲 OR #乙) AND #丙".into()), ..Default::default() };
    let got = contents(&query(&c, &grouped, 0).unwrap());
    assert_eq!(got, contents(&query(&c, &expr, 0).unwrap()), "条件组与表达式逐值相同");
    assert_eq!(got.len(), 2, "只有同时满足丙与(甲或乙)的两条");
}

/// ② 组间 op='or' = 各组并集,与 `#甲 OR #乙` 等价
#[test]
fn group_op_or_unions_groups() {
    let mut c = db();
    for src in ["甲笔记 #甲", "乙笔记 #乙", "丙笔记 #丙", "甲乙 #甲 #乙"] {
        create_plain(&mut c, src).unwrap();
    }
    let grouped = FilterConditions {
        group_op: "or".into(),
        groups: vec![grp("and", vec![tag("甲")]), grp("and", vec![tag("乙")])],
        ..Default::default()
    };
    let expr = FilterConditions { expr: Some("#甲 OR #乙".into()), ..Default::default() };
    let got = contents(&query(&c, &grouped, 0).unwrap());
    assert_eq!(got.len(), 3, "甲、乙、甲乙三条");
    assert_eq!(got, contents(&query(&c, &expr, 0).unwrap()));
}

/// ③ 空组丢弃:只有空组 -> 回到 1=1;空 OR 组不当假(不把整条查询变空)
#[test]
fn empty_groups_are_dropped_and_or_empty_is_not_false() {
    let mut c = db();
    create_plain(&mut c, "甲笔记 #甲").unwrap();
    create_plain(&mut c, "无关").unwrap();
    let only_empty = FilterConditions { groups: vec![grp("or", vec![])], ..Default::default() };
    assert_eq!(where_clause(&only_empty).unwrap().0, "1=1");
    let with_empty = FilterConditions {
        groups: vec![grp("or", vec![]), grp("and", vec![tag("甲")])],
        ..Default::default()
    };
    let flat = FilterConditions {
        tags: vec![TagCond { path: "甲".into(), include_children: true }],
        ..Default::default()
    };
    assert_eq!(
        contents(&query(&c, &with_empty, 0).unwrap()),
        contents(&query(&c, &flat, 0).unwrap()),
        "空 OR 组丢弃后与单条件等价"
    );
}

/// ④ 组间 OR 整体加括号(否则 `1=1 AND (a) OR (b)` 会因 OR 优先级多命中)
#[test]
fn group_op_is_parenthesized_before_and() {
    let grouped = FilterConditions {
        group_op: "or".into(),
        groups: vec![grp("and", vec![tag("甲")]), grp("and", vec![tag("乙")])],
        ..Default::default()
    };
    let (sql, _) = where_clause(&grouped).unwrap();
    assert!(sql.starts_with("1=1 AND (("), "组间 OR 必须先整体成组:{sql}");
    assert!(sql.contains(" OR "), "{sql}");
}

/// ⑤ 非法 op 取值被 validate 拦下(归一会静默压成 and,校验必须先查原始值)
#[test]
fn validate_rejects_bad_group_ops() {
    let bad_inner = FilterConditions {
        groups: vec![FilterGroup { op: "xor".into(), items: vec![] }],
        ..Default::default()
    };
    assert!(validate(&bad_inner).is_err());
    let bad_outer = FilterConditions { group_op: "xor".into(), ..Default::default() };
    assert!(validate(&bad_outer).is_err());
    let ok = FilterConditions { groups: vec![grp("and", vec![tag("甲")])], ..Default::default() };
    assert!(validate(&ok).is_ok());
}
