//! `#X` 逐段寻址(spec 2026-10-08 §5.1 / P3 / P5):沿 `parent_id` 逐段比较
//! `entity_name(meta)`(**不读 `path`**),同父同名取 id 最小;`path` 只是显示缓存,
//! 名字含 `/` 时不可作寻址依据。用例直接摆 `entities` 行,以造出 `ensure_path` 不会产生的场面。
use super::*;
use crate::db::migrate;
use crate::db::repos::tags::test_support::install_entity_views;
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    install_entity_views(&c);
    c
}

/// 直接摆一行树内实体(绕过 ensure_path:同父同名 / path 缓存不对等场面只有手摆得到)
fn insert(c: &Connection, id: i64, name: &str, parent: Option<i64>, path: &str, depth: i64) {
    c.execute(
        "INSERT INTO entities(id, meta, parent_id, path, depth, created_at)
         VALUES(?1, ?2, ?3, ?4, ?5, datetime('now','localtime'))",
        params![id, name, parent, path, depth],
    )
    .unwrap();
    if let Some(p) = parent {
        c.execute(
            "INSERT INTO edges(source_id, target_id, kind, remark, created_at)
             VALUES(?1, ?2, 'child', '', datetime('now','localtime'))",
            params![p, id],
        )
        .unwrap();
    }
}

fn existing(c: &Connection, path: &str) -> Option<i64> {
    existing_id(c, path).unwrap()
}

/// ① 正常父子链:`a/b/c` 逐段命中,中间段缺失就不命中
#[test]
fn resolves_by_parent_chain() {
    let c = db();
    insert(&c, 21, "a", None, "a", 1);
    insert(&c, 22, "b", Some(21), "a/b", 2);
    insert(&c, 23, "c", Some(22), "a/b/c", 3);
    assert_eq!(existing(&c, "a"), Some(21));
    assert_eq!(existing(&c, "a/b/c"), Some(23));
    assert_eq!(existing(&c, "a/x"), None, "中间段不存在就不命中");
}

/// ② 同父同名取 id 最小(P5 在 `#` 侧的同一裁决)
#[test]
fn same_parent_same_name_takes_smallest_id() {
    let c = db();
    insert(&c, 21, "a", None, "a", 1);
    insert(&c, 22, "b", Some(21), "a/b", 2);
    insert(&c, 9, "b", Some(21), "a/b-旧副本", 2);
    assert_eq!(existing(&c, "a/b"), Some(9));
}

/// ③ 变异自证靶点:把寻址改成读 `path` 后本用例变红 —— 父子链是真的,path 缓存是错的
#[test]
fn path_cache_is_not_an_addressing_key() {
    let c = db();
    insert(&c, 31, "a", None, "错/缓存", 1);
    insert(&c, 32, "b", Some(31), "错/缓存/更错", 2);
    assert_eq!(existing(&c, "a/b"), Some(32), "寻址看 parent_id + 名字,不看 path");
    // 反向:另有实体 path 恰好是 a/b,但它的父子链是 丙 -> 丁
    insert(&c, 41, "丙", None, "a", 1);
    insert(&c, 42, "丁", Some(41), "a/b", 2);
    assert_eq!(existing(&c, "a/b"), Some(32), "path 命中不算命中");
}

/// ④ 006 之前的幻影层级(name=path=`a/b` 但无父节点)不抢寻址,交给 ensure_path 和解
#[test]
fn phantom_level_does_not_capture_path() {
    let c = db();
    insert(&c, 51, "a/b", None, "a/b", 0);
    assert_eq!(existing(&c, "a/b"), None);
}

/// ⑤ 树外实体(笔记)path 为 NULL:即便首行恰好等于段名,`#` 也不该指向它
#[test]
fn notes_outside_tree_are_not_addressable() {
    let c = db();
    c.execute(
        "INSERT INTO entities(id, meta, created_at) VALUES(61, 'a', datetime('now','localtime'))",
        [],
    )
    .unwrap();
    assert_eq!(existing(&c, "a"), None);
}

/// ⑥ 端到端:`resolve_paths` 在同一父子链上落到 id 最小的那个
#[test]
fn resolve_paths_lands_on_smallest_id() {
    let c = db();
    insert(&c, 21, "a", None, "a", 1);
    insert(&c, 22, "b", Some(21), "a/b", 2);
    insert(&c, 9, "b", Some(21), "a/b-旧副本", 2);
    assert_eq!(resolve_paths(&c, &["a/b".to_string()]).unwrap(), vec![9]);
}
