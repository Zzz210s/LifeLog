//! 标签树仓库层核心测试(测试先行):ensure_path / link_paths / counts / complete。
//! 含 C-2 回归:存量名含 '/' 的平铺标签(name == path)与新路径空间撞车时必须显式和解。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::{self, notes_filter::*, query};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 标签表全量快照(按 id 排序),用于"不改库"断言
fn dump(c: &Connection) -> Vec<String> {
    let mut stmt = c
        .prepare("SELECT id, name, COALESCE(parent_id, 0), path, depth FROM tags ORDER BY id")
        .unwrap();
    let rows = stmt
        .query_map([], |r| {
            Ok(format!(
                "{}|{}|{}|{}|{}",
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?
            ))
        })
        .unwrap();
    rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

fn segs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn hits(c: &Connection, kw: &str) -> usize {
    query(
        c,
        &FilterConditions { keyword: Some(kw.into()), ..empty() },
        0,
    )
    .unwrap()
    .len()
}

/// ① 建父级且幂等:两次 ensure_path 不重复建,从中间段调用也只复用
#[test]
fn ensure_path_creates_ancestors_once() {
    let c = db();
    let leaf = ensure_path(&c, &segs(&["工作", "项目A"])).unwrap();
    assert_eq!(ensure_path(&c, &segs(&["工作", "项目A"])).unwrap(), leaf);
    assert_eq!(ensure_path(&c, &segs(&["工作"])).unwrap(), id_at(&c, "工作"));
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 2);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作' AND name='工作' AND depth=1 AND parent_id IS NULL"),
        1
    );
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作/项目A' AND name='项目A' AND depth=2 AND parent_id=(SELECT id FROM tags WHERE path='工作')"),
        1
    );
    assert_eq!(dump(&c).len(), 2);
    // 空路径段是调用方错误:报错而不是建出畸形节点
    assert!(ensure_path(&c, &[]).is_err());
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 2);
}

/// ② 链接只落在末端:父级 self_count 为 0,subtree_count 含子级链接
#[test]
fn link_only_on_leaf_keeps_parent_uncounted() {
    let mut c = db();
    notes::create_plain(&mut c, "开会记录 #工作/项目A").unwrap();
    let list = counts(&c).unwrap();
    let parent = list.iter().find(|t| t.path == "工作").unwrap();
    let leaf = list.iter().find(|t| t.path == "工作/项目A").unwrap();
    assert_eq!((parent.self_count, parent.subtree_count), (0, 1));
    assert_eq!((leaf.self_count, leaf.subtree_count), (1, 1));
    assert_eq!(parent.depth, 1);
    assert_eq!(leaf.depth, 2);
}

/// 计数口径:一条笔记同时链了子树里的父与子时,subtree_count 仍只算 **1 条笔记**
/// (曾按链接数求和,导致侧栏 809 与标签筛选 318 对不上)
#[test]
fn subtree_count_dedupes_notes_linked_to_several_nodes() {
    let mut c = db();
    notes::create_plain(&mut c, "一条笔记 #工作 #工作/项目A").unwrap();
    let list = counts(&c).unwrap();
    let parent = list.iter().find(|t| t.path == "工作").unwrap();
    let leaf = list.iter().find(|t| t.path == "工作/项目A").unwrap();
    assert_eq!((parent.self_count, parent.subtree_count), (1, 1));
    assert_eq!((leaf.self_count, leaf.subtree_count), (1, 1));
    // 两条笔记分别链父与子时才是 2
    notes::create_plain(&mut c, "另一条 #工作/项目A").unwrap();
    let list = counts(&c).unwrap();
    let parent = list.iter().find(|t| t.path == "工作").unwrap();
    assert_eq!((parent.self_count, parent.subtree_count), (1, 2));
}

/// ⑧ counts:父子各一条链接时,父的 self_count=1、subtree_count=2
#[test]
fn counts_self_and_subtree() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作").unwrap();
    notes::create_plain(&mut c, "b #工作/项目A").unwrap();
    let list = counts(&c).unwrap();
    let parent = list.iter().find(|t| t.path == "工作").unwrap();
    let leaf = list.iter().find(|t| t.path == "工作/项目A").unwrap();
    assert_eq!((parent.self_count, parent.subtree_count), (1, 2));
    assert_eq!((leaf.self_count, leaf.subtree_count), (1, 1));
    // 路径序返回,深度字段可直接给界面用
    assert_eq!(list.iter().map(|t| t.path.as_str()).collect::<Vec<_>>(), vec!["工作", "工作/项目A"]);
}

/// ⑨ 前缀补全:按 path 前缀匹配;'%' 必须当字面字符而非 LIKE 通配符
#[test]
fn complete_returns_prefix_paths_and_treats_chars_literally() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作/项目A").unwrap();
    notes::create_plain(&mut c, "b #生活").unwrap();
    // 存量根名可能含 % / _(006 原样保留),故前缀比较用 substr 而非 LIKE
    c.execute_batch(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES('a%b', NULL, 'a%b', 1);
         INSERT INTO tags(name, parent_id, path, depth) VALUES('abc', NULL, 'abc', 1);",
    )
    .unwrap();
    assert_eq!(complete(&c, "工").unwrap(), vec!["工作", "工作/项目A"]);
    assert_eq!(complete(&c, "工作/").unwrap(), vec!["工作/项目A"]);
    assert_eq!(complete(&c, "a%").unwrap(), vec!["a%b"]);
    assert!(complete(&c, "无此").unwrap().is_empty());
}

#[path = "tags_tree_legacy_name_tests.rs"]
mod legacy_name_tests;

/// 按路径取标签 id(两份测试文件共用:父模块定义,子模块用 super::* 取)
fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0))
        .unwrap()
}
