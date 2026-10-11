//! 名字点与线的读写(spec §3.2 / §6.4;计划 T3.2):
//! `resolve_or_create_name_point` 按 `meta` 逐字节复用/建点;`rename_line_name` 改点
//! `meta`(撞名拒绝);`create_line` / `remove_line` 细粒度增删线。
//! 同对 (from,to) 可并存「一条无名字线 + 每个名字各一条」(spec §3.2 / §14 P9)。
use super::*;
use crate::db::repos::tags::{remove_tag_relation, set_tag_relation};
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

/// 该对 (from,to) 的线数(含无名字线与子级线;本文件的用例都不建树)
fn line_count(c: &Connection, from: i64, to: i64) -> i64 {
    c.query_row(
        "SELECT COUNT(*) FROM lines WHERE from_id=?1 AND to_id=?2",
        params![from, to],
        |r| r.get(0),
    )
    .unwrap()
}

/// 该对的线名文本集合(按 id 升序;无名字线给空串)
fn name_texts(c: &Connection, from: i64, to: i64) -> Vec<String> {
    let mut stmt = c
        .prepare(
            "SELECT COALESCE(n.meta,'') FROM lines l LEFT JOIN points n ON n.id = l.name_id
             WHERE l.from_id=?1 AND l.to_id=?2 ORDER BY l.id",
        )
        .unwrap();
    let rows = stmt.query_map(params![from, to], |r| r.get(0)).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

fn name_points(c: &Connection, meta: &str) -> i64 {
    c.query_row("SELECT COUNT(*) FROM points WHERE meta=?1", params![meta], |r| r.get(0)).unwrap()
}

/// ① 名字点按 `meta` 逐字节复用:同文本只建一个点,不同文本各建一个
#[test]
fn resolve_or_create_reuses_by_byte_exact_meta() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    let d = ensure(&c, "丙");
    set_tag_relation(&mut c, a, b, "国籍").unwrap();
    let first = resolve_or_create_name_point(&c, "国籍").unwrap();
    let again = resolve_or_create_name_point(&c, "国籍").unwrap();
    assert_eq!(first, again, "已有纯名字点必须复用");

    set_tag_relation(&mut c, a, d, "国别").unwrap();
    let other = resolve_or_create_name_point(&c, "国别").unwrap();
    assert_ne!(first, other, "近名不同字各建一点");
    assert_eq!(name_points(&c, "国籍"), 1);
    assert_eq!(name_points(&c, "国别"), 1);
}

/// ② `rename_line_name` 改的是名字点:`meta` 变了,**引用它的每条线**的 nameText 一起变,
/// 线总数不变(spec 已定口径 3 的正效果)
#[test]
fn rename_line_name_changes_every_line_with_that_name() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    let d = ensure(&c, "丙");
    let e = ensure(&c, "丁");
    set_tag_relation(&mut c, a, b, "国籍").unwrap();
    set_tag_relation(&mut c, a, d, "国籍").unwrap();
    set_tag_relation(&mut c, e, b, "国籍").unwrap();
    let lines_before: i64 = c.query_row("SELECT COUNT(*) FROM lines", [], |r| r.get(0)).unwrap();
    let nid = resolve_or_create_name_point(&c, "国籍").unwrap();

    rename_line_name(&mut c, nid, "国别").unwrap();

    assert_eq!(name_texts(&c, a, b), vec!["国别"]);
    assert_eq!(name_texts(&c, a, d), vec!["国别"]);
    assert_eq!(name_texts(&c, e, b), vec!["国别"]);
    let lines_after: i64 = c.query_row("SELECT COUNT(*) FROM lines", [], |r| r.get(0)).unwrap();
    assert_eq!(lines_before, lines_after, "改名不增删线");
    assert_eq!(name_points(&c, "国籍"), 0, "旧名文本已不存在");
    assert_eq!(name_points(&c, "国别"), 1);
}

/// ③ 改名撞名:目标 `meta` 已是另一个纯名字点 → 拒绝(中文提示),库不动
#[test]
fn rename_line_name_rejects_existing_name_point() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    let d = ensure(&c, "丙");
    set_tag_relation(&mut c, a, b, "国籍").unwrap();
    set_tag_relation(&mut c, a, d, "状态").unwrap();
    let nid = resolve_or_create_name_point(&c, "国籍").unwrap();

    let err = rename_line_name(&mut c, nid, "状态").unwrap_err();

    assert!(err.contains("已存在") || err.contains("重名"), "要中文撞名提示: {err}");
    assert_eq!(name_texts(&c, a, b), vec!["国籍"], "拒绝后原名不动");
    assert_eq!(name_points(&c, "状态"), 1);
}

/// ④ 同一对可并存「一条无名字线 + 每个名字各一条」;同对同名字重复插被唯一索引拒
#[test]
fn same_pair_holds_unnamed_and_each_name() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    set_tag_relation(&mut c, a, b, "").unwrap();
    let guo = resolve_or_create_name_point(&c, "国籍").unwrap();
    let st = resolve_or_create_name_point(&c, "状态").unwrap();

    create_line(&mut c, a, b, Some(guo)).unwrap();
    create_line(&mut c, a, b, Some(st)).unwrap();

    assert_eq!(line_count(&c, a, b), 3);
    assert_eq!(name_texts(&c, a, b), vec!["", "国籍", "状态"]);
    let err = create_line(&mut c, a, b, Some(guo)).unwrap_err();
    assert!(err.contains("已存在") || err.contains("重复"), "同名线重复要给中文错: {err}");
    assert_eq!(line_count(&c, a, b), 3, "被拒后不增线");
}

/// ⑤ `create_line` 拒绝自指与成环(与 set_tag_relation 同口径)
#[test]
fn create_line_rejects_self_reference_and_cycle() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    assert!(create_line(&mut c, a, a, None).unwrap_err().contains("自己"));
    create_line(&mut c, a, b, None).unwrap();
    let err = create_line(&mut c, b, a, None).unwrap_err();
    assert!(err.contains("循环"), "要中文成环提示: {err}");
    assert_eq!(line_count(&c, a, b), 1);
}

/// ⑥ `remove_line` 按 id 删一条(幂等),不碰同对的别的线
#[test]
fn remove_line_deletes_only_that_line() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    let unnamed = create_line(&mut c, a, b, None).unwrap();
    let guo = resolve_or_create_name_point(&c, "国籍").unwrap();
    let named = create_line(&mut c, a, b, Some(guo)).unwrap();

    remove_line(&c, unnamed).unwrap();

    assert_eq!(line_count(&c, a, b), 1);
    assert_eq!(name_texts(&c, a, b), vec!["国籍"]);
    remove_line(&c, unnamed).unwrap(); // 幂等:再删一次不报错
    assert_eq!(line_count(&c, a, b), 1);
    remove_line(&c, named).unwrap();
    assert_eq!(line_count(&c, a, b), 0);
}

/// ⑦ `remove_tag_relation` 的可选名字参数:给了只删那条有名线;不给只删无名字线
#[test]
fn remove_tag_relation_selects_the_line_by_name() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    set_tag_relation(&mut c, a, b, "").unwrap();
    let guo = resolve_or_create_name_point(&c, "国籍").unwrap();
    create_line(&mut c, a, b, Some(guo)).unwrap();

    remove_tag_relation(&mut c, a, b, Some(guo)).unwrap();

    assert_eq!(name_texts(&c, a, b), vec![""], "只删了名字线,无名字线还在");
    remove_tag_relation(&mut c, a, b, None).unwrap();
    assert_eq!(line_count(&c, a, b), 0);
}
