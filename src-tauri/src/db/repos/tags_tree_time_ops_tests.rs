//! 时间标签降级为普通标签后的结构操作(spec 2026-09-17 D3):
//! `时间排序` 及其后代可以在侧栏改名 / 移动 / 删除(旧的时间子树守卫已删除),
//! 且 FTS 与视图条件随路径重写一起更新。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes;
use rusqlite::Connection;

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

fn fts_tags(c: &Connection, id: i64) -> String {
    c.query_row("SELECT tags FROM notes_fts WHERE rowid=?1", [id], |r| r.get(0))
        .unwrap()
}

/// 造一棵时间子树并挂一条笔记:时间排序/2026/09/15(depth 1..4)
fn with_time_tree() -> (Connection, i64) {
    let mut c = db();
    notes::create_on(&mut c, "当天笔记 #工作", "2026-09-15").unwrap();
    let day = id_at(&c, "时间排序/2026/09/15");
    (c, day)
}

/// 改名:时间根及其后代 path 前缀整棵重写,受影响笔记的 FTS 同步(旧守卫已删)
#[test]
fn time_root_can_be_renamed_and_fts_follows() {
    let (mut c, _) = with_time_tree();
    let root = id_at(&c, "时间排序");
    let note_id: i64 = c.query_row("SELECT id FROM notes LIMIT 1", [], |r| r.get(0)).unwrap();
    assert!(fts_tags(&c, note_id).contains("时间排序/2026/09/15"));

    rename(&mut c, root, "日期").unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序'"), 0);
    for p in ["日期", "日期/2026", "日期/2026/09", "日期/2026/09/15"] {
        assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE path='{p}'")), 1, "缺 {p}");
    }
    let tags = fts_tags(&c, note_id);
    assert!(tags.contains("日期/2026/09/15"), "FTS 必须跟着改名:{tags}");
    assert!(!tags.contains("时间排序"), "旧路径不得残留:{tags}");
    // 普通标签不受影响
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作'"), 1);
}

/// 改名后新建笔记仍按模板生成:模板还指 `时间排序` 就再建一个同名根(D5 的可配置行为)
#[test]
fn create_after_rename_follows_the_template() {
    let (mut c, _) = with_time_tree();
    let root = id_at(&c, "时间排序");
    rename(&mut c, root, "日期").unwrap();

    let n = notes::create(&mut c, "改名后新建").unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序'"), 1, "模板指向的根被重新建出");
    assert!(
        n.tags.iter().any(|t| t.starts_with("时间排序/")),
        "模板决定自动标签路径:{:?}",
        n.tags
    );
    // 旧根下的历史笔记不动(D9:存量原样保留)
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='日期/2026/09/15'"), 1);
}

/// 移动:年节点可移到普通标签下,子孙 path 与链接一并重写
#[test]
fn time_node_can_be_moved_under_a_normal_tag() {
    let (mut c, _) = with_time_tree();
    let year = id_at(&c, "时间排序/2026");
    let work = id_at(&c, "工作");

    move_to(&mut c, year, Some(work)).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作/2026/09/15'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序/2026'"), 0);
    // 父链上只剩没人链接的空容器时被回收;时间根仍有其它笔记? 这里 2026 是唯一后代 → 根被回收
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序'"), 0);
    // 笔记仍挂在移动后的日节点上
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tag_links l JOIN tags t ON t.id=l.tag_id WHERE t.path='工作/2026/09/15'"),
        1
    );
}

/// 删除:时间子树可整棵删除,笔记自身不消失,其它标签保留
#[test]
fn time_subtree_can_be_deleted() {
    let (mut c, day) = with_time_tree();
    let note_id: i64 = c.query_row("SELECT id FROM notes LIMIT 1", [], |r| r.get(0)).unwrap();

    delete_subtree(&mut c, day).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM notes"), 1, "笔记永不因删标签而消失");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序/2026/09/15'"), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序'"), 0, "空容器回收");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作'"), 1);
    assert_eq!(fts_tags(&c, note_id), "工作", "FTS 里只剩普通标签");

    // 普通标签照常可删
    let work = id_at(&c, "工作");
    delete_subtree(&mut c, work).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作'"), 0);
}
