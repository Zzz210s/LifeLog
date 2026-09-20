//! link_paths 的别名解析接入测试(spec D2/D3,G1 第 3 条):
//! 别名只是"这个字符串指向哪个标签"——命中即归一到目标标签的当前路径,不新建同名节点;
//! 未登记的字符串原样建节点(不做模糊猜测)。
use super::*;
use crate::db::migrate;
use crate::db::repos::{notes, tag_alias};
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0))
        .unwrap()
}

/// ① 登记 `日漫 -> 追番/日漫` 后,#日漫 的笔记链到目标节点,且**不**新建 日漫 节点
#[test]
fn link_paths_resolves_alias_without_creating_node() {
    let mut c = db();
    let n = notes::create_plain(&mut c, "看番 #追番/日漫").unwrap();
    let target = id_at(&c, "追番/日漫");
    tag_alias::add(&c, "日漫", target).unwrap();

    // 走替换语义:原来链的是目标路径,现在只写别名,仍应落在同一个节点上
    link_paths(&c, n.id, &["日漫".to_string()]).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='日漫'"), 0, "别名不是节点");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 2, "只有 追番 与 追番/日漫");
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={target} AND target_type='note' AND target_id={}", n.id)),
        1
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links"), 1, "替换语义:旧链接不残留");
    // FTS 标签列仍是目标标签的路径(触发器口径不变)
    let fts: String = c
        .query_row("SELECT tags FROM notes_fts WHERE rowid=?1", params![n.id], |r| r.get(0))
        .unwrap();
    assert_eq!(fts, "追番/日漫");
}

/// ② 同一笔记同时写别名与规范路径:解析后是同一个节点,只留一条链接
#[test]
fn link_paths_dedupes_alias_and_canonical_path() {
    let mut c = db();
    let n = notes::create_plain(&mut c, "看番 #追番/日漫").unwrap();
    let target = id_at(&c, "追番/日漫");
    tag_alias::add(&c, "日漫", target).unwrap();

    link_paths(&c, n.id, &["日漫".to_string(), "追番/日漫".to_string()]).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 2);
}

/// ③ 未登记的字符串按原路径建节点;"近似"别名不生效(D2:不做模糊猜测)
#[test]
fn link_paths_creates_nodes_for_unregistered_strings() {
    let mut c = db();
    notes::create_plain(&mut c, "看番 #追番/日漫").unwrap();
    let target = id_at(&c, "追番/日漫");
    tag_alias::add(&c, "日漫", target).unwrap();

    let n = notes::create_plain(&mut c, "另一条 #日漫2 #番剧").unwrap();

    // 近似串 日漫2 不得被别名吞掉:照旧建节点
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='日漫2'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='番剧'"), 1);
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE target_id={} AND target_type='note'", n.id)),
        2
    );
}

/// 真实标签优先于别名:同名别名不该挡住"确实存在的那个标签"
#[test]
fn real_tag_wins_over_alias() {
    let mut c = db();
    // 先造两个真实标签:日漫 与 追番/日漫
    let n1 = notes::create_plain(&mut c, "旧写法 #日漫").unwrap();
    let real = id_at(&c, "日漫");
    let n2 = notes::create_plain(&mut c, "新写法 #追番/日漫").unwrap();
    let target = id_at(&c, "追番/日漫");
    // 把 日漫 登记为 追番/日漫 的别名(模拟"旧名残留"):真实标签仍在
    tag_alias::add(&c, "日漫", target).unwrap();
    // 再写 #日漫:必须落在真实标签 日漫 上,而不是被别名吃掉
    link_paths(&c, n1.id, &["日漫".to_string()]).unwrap();
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={real} AND target_type='note' AND target_id={}", n1.id)), 1);
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={target} AND target_type='note' AND target_id={}", n1.id)), 0);
    // 目标自身不受影响
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={target} AND target_type='note' AND target_id={}", n2.id)), 1);
    // 真实标签不存在的字符串仍走别名归一
    tag_alias::add(&c, "日漫番剧", target).unwrap();
    let n3 = notes::create_plain(&mut c, "第三处 #日漫番剧").unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='日漫番剧'"), 0, "别名不建节点");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={target} AND target_type='note' AND target_id={}", n3.id)), 1);
}
