//! 编辑/删除笔记时的标签回收边界(C-1 回归)与链接更新粒度。
//! C-1:父节点天生没有 tag_links 行,旧实现"无链接即孤儿"会把整棵子树级联删掉,
//! 导致其它笔记的嵌套标签静默消失;现改为"既无链接又无子节点"才回收。
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

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0))
        .unwrap()
}

fn f(kw: &str) -> FilterConditions {
    FilterConditions { keyword: Some(kw.into()), ..empty() }
}

/// C-1 回归(编辑):#a/b 写入两条笔记 -> 编辑其中一条 -> 另一条仍带 a/b
#[test]
fn update_keeps_nested_tag_of_other_note() {
    let mut c = db();
    let a = notes::create_plain(&mut c, "一 #a/b").unwrap();
    let b = notes::create_plain(&mut c, "二 #a/b").unwrap();

    notes::update(&mut c, a.id, "一改").unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='a'"), 1, "父节点有子节点,不得当孤儿回收");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='a/b'"), 1);
    let leaf = id_at(&c, "a/b");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links WHERE tag_id=(SELECT id FROM tags WHERE path='a')"), 0);
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={leaf} AND target_type='note'")),
        1,
        "另一条笔记仍应带 a/b"
    );
    let hit = query(&c, &f("a/b"), 0).unwrap();
    assert_eq!(hit.len(), 1);
    assert_eq!(hit[0].id, b.id);
}

/// C-1 回归(删除笔记):删除一条不应带走另一条的嵌套标签
#[test]
fn delete_keeps_nested_tag_of_other_note() {
    let mut c = db();
    let a = notes::create_plain(&mut c, "一 #a/b").unwrap();
    let b = notes::create_plain(&mut c, "二 #a/b").unwrap();

    notes::delete(&mut c, a.id).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='a'"), 1);
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={} AND target_type='note'", id_at(&c, "a/b"))),
        1
    );
    assert_eq!(query(&c, &f("a/b"), 0).unwrap().len(), 1);
    assert_eq!(query(&c, &f("a/b"), 0).unwrap()[0].id, b.id);
}

/// 更新粒度:未变化的标签链接保持原样(节点 id 不变,不删了重建)
#[test]
fn update_keeps_unchanged_tag_node_identity() {
    let mut c = db();
    let a = notes::create_plain(&mut c, "旧 #保持 #换掉").unwrap();
    let keep = id_at(&c, "保持");

    notes::update(&mut c, a.id, "新 #保持 #新增").unwrap();

    assert_eq!(id_at(&c, "保持"), keep);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='换掉'"), 0, "无链接又无子节点才回收");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='新增'"), 1);
}

/// 更新粒度:旧标签(名称含空格,新语法不再产生)只在确实无人引用时才回收
#[test]
fn update_keeps_legacy_tag_used_by_other_note() {
    let mut c = db();
    let a = notes::create_plain(&mut c, "a").unwrap();
    let b = notes::create_plain(&mut c, "b").unwrap();
    // 模拟 006 原样保留的存量平铺标签(先建笔记再插标签,否则会被无引用回收扫掉)
    c.execute(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES('工作 计划', NULL, '工作 计划', 1)",
        [],
    )
    .unwrap();
    let legacy = id_at(&c, "工作 计划");
    c.execute(
        "INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'note', ?2), (?1, 'note', ?3)",
        rusqlite::params![legacy, a.id, b.id],
    )
    .unwrap();

    // b 不再引用该旧标签;a 仍引用 -> 节点与 a 的链接都必须保留
    notes::update(&mut c, b.id, "b 改了").unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作 计划'"), 1);
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={legacy}")), 1);
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={legacy} AND target_id={}", a.id)),
        1
    );
}
