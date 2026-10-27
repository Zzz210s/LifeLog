//! 线写入入口的用例(B):幂等、冲突可见、派生列(`is_cited`)与视图一致。
use super::*;
use crate::db::migrate;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    crate::db::sql_functions::register(&c).unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 建两个树外点(笔记),返回 (a, b)
fn two_points(c: &Connection) -> (i64, i64) {
    let mut ids = Vec::new();
    for meta in ["甲", "乙"] {
        c.execute(
            "INSERT INTO points(meta, is_cited, created_at) VALUES(?1, 0, '2026-01-01')",
            [meta],
        )
        .unwrap();
        ids.push(c.last_insert_rowid());
    }
    (ids[0], ids[1])
}

fn name_point(c: &Connection, meta: &str) -> i64 {
    c.execute(
        "INSERT INTO points(meta, is_cited, created_at) VALUES(?1, 0, '2026-01-01')",
        [meta],
    )
    .unwrap();
    c.last_insert_rowid()
}

fn cited(c: &Connection, id: i64) -> i64 {
    c.query_row("SELECT is_cited FROM points WHERE id = ?1", [id], |r| r.get(0)).unwrap()
}

#[test]
fn insert_is_idempotent_and_marks_target_cited() {
    let c = db();
    let (a, b) = two_points(&c);
    assert!(insert_tag(&c, a, b).unwrap(), "第一次应真插入");
    assert!(!insert_tag(&c, a, b).unwrap(), "重复插入应幂等返回 false");
    let n: i64 = c
        .query_row("SELECT COUNT(*) FROM tag_lines WHERE from_id = ?1 AND to_id = ?2", [a, b], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1, "同一对点只能有一条无名线");
    assert_eq!(cited(&c, b), 1, "被引用的点 is_cited 应为 1");
}

#[test]
fn same_pair_can_hold_tag_and_named_lines() {
    let c = db();
    let (a, b) = two_points(&c);
    let nm = name_point(&c, "国籍");
    insert_tag(&c, a, b).unwrap();
    insert(&c, a, b, Some(nm)).unwrap();
    let all: i64 = c
        .query_row("SELECT COUNT(*) FROM lines WHERE from_id = ?1 AND to_id = ?2", [a, b], |r| r.get(0))
        .unwrap();
    assert_eq!(all, 2, "同对可并存无名线 + 每个名字各一条");
}

#[test]
fn insert_strict_reports_conflict_in_chinese() {
    let c = db();
    let (a, b) = two_points(&c);
    insert_tag(&c, a, b).unwrap();
    let err = insert_strict(&c, a, b, None, "该线已存在").unwrap_err();
    assert!(err.to_string().contains("该线已存在"), "{err}");
}

#[test]
fn delete_tag_line_leaves_named_lines_alone() {
    let c = db();
    let (a, b) = two_points(&c);
    let nm = name_point(&c, "国籍");
    insert_tag(&c, a, b).unwrap();
    insert(&c, a, b, Some(nm)).unwrap();
    // 要删时需要先"被引用"状态为 1
    assert_eq!(cited(&c, b), 1);

    let removed = delete_tag_line(&c, a, b).unwrap();
    assert_eq!(removed, 1, "只删无名线一条");
    let left: i64 = c
        .query_row("SELECT COUNT(*) FROM relation_lines WHERE from_id = ?1 AND to_id = ?2", [a, b], |r| r.get(0))
        .unwrap();
    assert_eq!(left, 1, "名线(关系)必须原样保留");
    assert_eq!(cited(&c, b), 1, "还有名线指向它,仍算被引用");
}

#[test]
fn delete_by_id_resyncs_is_cited() {
    let c = db();
    let (a, b) = two_points(&c);
    insert_tag(&c, a, b).unwrap();
    let line: i64 = c.query_row("SELECT id FROM lines", [], |r| r.get(0)).unwrap();
    assert_eq!(delete_by_id(&c, line).unwrap(), 1);
    assert_eq!(cited(&c, b), 0, "最后一个入边删掉后 is_cited 应回落 0");
    let left: i64 = c.query_row("SELECT COUNT(*) FROM lines", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0);
}

#[test]
fn tree_line_uses_reserved_name_point() {
    let c = db();
    let (a, b) = two_points(&c);
    insert_tree(&c, a, b).unwrap();
    let nm: i64 = c.query_row("SELECT name_id FROM lines", [], |r| r.get(0)).unwrap();
    assert_eq!(nm, crate::db::repos::entities::reserved::TREE_NAME_ID);
    let in_tree: i64 = c
        .query_row("SELECT COUNT(*) FROM tree_lines WHERE from_id = ?1 AND to_id = ?2", [a, b], |r| r.get(0))
        .unwrap();
    assert_eq!(in_tree, 1, "子级线必须被 tree_lines 视图看见");
    assert_eq!(cited(&c, b), 0, "子级线是结构边,不算被引用");
}

#[test]
fn delete_non_tree_touching_keeps_tree_lines() {
    let c = db();
    let (a, b) = two_points(&c);
    insert_tree(&c, a, b).unwrap();
    insert_tag(&c, a, b).unwrap();
    assert_eq!(delete_non_tree_touching(&c, a).unwrap(), 1);
    let tree: i64 = c.query_row("SELECT COUNT(*) FROM tree_lines", [], |r| r.get(0)).unwrap();
    let tag: i64 = c.query_row("SELECT COUNT(*) FROM tag_lines", [], |r| r.get(0)).unwrap();
    assert_eq!((tree, tag), (1, 0), "只清内容线,子级线留着");
}

#[test]
fn delete_tree_lines_to_detaches_from_tree() {
    let c = db();
    let (a, b) = two_points(&c);
    insert_tree(&c, a, b).unwrap();
    assert_eq!(delete_tree_lines_to(&c, b).unwrap(), 1);
    let tree: i64 = c.query_row("SELECT COUNT(*) FROM tree_lines", [], |r| r.get(0)).unwrap();
    assert_eq!(tree, 0, "子级线被摘掉");
}
