//! 结构操作补充测试(自 tags_tree_ops_tests.rs 拆出以守 200 行上限):
//! 小账 B(impact 去重笔记数)、小账 D(move_to 回收空容器)与小账 E(深层移动被允许)。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes;
use crate::db::repos::tags::invariants_tests::{
    assert_filter_paths_exist, assert_fts_matches_edges, assert_no_orphan_tags,
};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    crate::db::repos::tags::test_support::install_entity_views(&c);
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0))
        .unwrap()
}

/// 小账 B:impact 第二项是去重后的笔记数,一条笔记同时链父与子标签时只计 1
#[test]
fn impact_second_is_distinct_note_count() {
    let mut c = db();
    let n = notes::create_plain(&mut c, "纪要 #工作 #工作/项目A").unwrap();
    let root = id_at(&c, "工作");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links WHERE tag_id IN (SELECT id FROM tags)"), 2);
    assert_eq!(impact(&c, root).unwrap(), (1, 1), "两行链接指向同一条笔记,笔记数仍为 1");
    assert_eq!(n.tags.len(), 2);
}

/// 小账 D:移走最后的子节点后,变成空容器的旧父级一并回收(与 delete_subtree 同口径)
#[test]
fn move_out_last_child_recycles_emptied_parent() {
    let mut c = db();
    notes::create_plain(&mut c, "纪要 #工作/项目A").unwrap();
    let leaf = id_at(&c, "工作/项目A");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 2);

    move_to(&mut c, leaf, None).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作'"), 0, "空容器父级回收");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='项目A' AND parent_id IS NULL"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links WHERE tag_id=(SELECT id FROM tags WHERE path='项目A')"), 1);
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
}

/// 小账 E:深层移动被允许 —— 2026-09-28 取消层级深度上限,原子树整体顺延(路径/深度/FTS 一致)
#[test]
fn move_beyond_former_max_depth_is_allowed() {
    let mut c = db();
    notes::create_plain(&mut c, "深处 #a1/a2/a3/a4/a5").unwrap();
    let x = ensure_path(&c, &["x".to_string()]).unwrap();
    let deepest = id_at(&c, "a1/a2/a3/a4/a5");

    let a1 = id_at(&c, "a1");
    move_to(&mut c, a1, Some(x)).unwrap();

    // 原 5 层子树整体下移一层:最深节点变成第 6 层(旧上限恰好是 5)
    assert_eq!(id_at(&c, "x/a1/a2/a3/a4/a5"), deepest);
    let deep = "path='x/a1/a2/a3/a4/a5'";
    assert_eq!(count(&c, &format!("SELECT depth FROM tags WHERE {deep}")), 6);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='a1'"), 0, "旧根路径不残留");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 6);
    // FTS 跟着新路径走
    let fts: String = c.query_row("SELECT tag_paths FROM entities_fts", [], |r| r.get(0)).unwrap();
    assert!(fts.contains("x/a1/a2/a3/a4/a5"), "FTS 未跟上新路径:{fts}");
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
    assert_filter_paths_exist(&c);
}
