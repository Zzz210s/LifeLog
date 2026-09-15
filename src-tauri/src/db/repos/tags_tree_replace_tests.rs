//! 按 id 替换链接与存量标签解析(修复轮 1):toggle_todo 在迁移数据上不得失败。
//! 存量标签(名称含空格、句末点等)的 path 不可解析时沿用既有 tag_id;
//! 小账 A 后名称内部的 `.`/`·`(如 v1.0)已可解析,走 ensure_path 按 path 复用既有行,同样不新建。
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

/// 模拟 006 原样保留的存量平铺标签(name == path,parent NULL,depth 1)
fn seed_legacy(c: &Connection, name: &str) -> i64 {
    c.execute(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES(?1, NULL, ?1, 1)",
        [name],
    )
    .unwrap();
    id_at(c, name)
}

/// resolve_id:可解析的建/复用节点;不可解析的沿用既有行;库里没有则报错
#[test]
fn resolve_id_handles_legacy_and_parseable_paths() {
    let c = db();
    let legacy = seed_legacy(&c, "v1.0");

    assert_eq!(resolve_id(&c, "v1.0").unwrap(), legacy);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 1, "沿用既有行,不新建");

    let leaf = resolve_id(&c, "工作/项目A").unwrap();
    assert_eq!(leaf, id_at(&c, "工作/项目A"));
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 3);

    assert!(resolve_id(&c, "看电影.").is_err(), "不可解析且库里没有:报错而非静默丢弃");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 3);
}

/// replace_links:增量替换(未变化的链接不动),无引用且无子节点的标签被回收
#[test]
fn replace_links_replaces_by_id_and_prunes_orphans() {
    let mut c = db();
    let n = notes::create_plain(&mut c, "x #甲").unwrap();
    let jia = id_at(&c, "甲");
    let yi = ensure_path(&c, &["乙".to_string()]).unwrap();

    replace_links(&c, n.id, &[jia, yi]).unwrap();
    replace_links(&c, n.id, &[jia, yi]).unwrap();
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE target_id={}", n.id)), 2);
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={jia}")), 1);

    replace_links(&c, n.id, &[yi]).unwrap();
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={jia}")), 0, "无链接又无子节点即回收");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={yi}")), 1);
}

/// Critical 回归:toggle_todo 在「#todo + 存量标签」的笔记上必须成功且不丢存量链接
#[test]
fn toggle_todo_keeps_legacy_tag_link() {
    let mut c = db();
    let n = notes::create_plain(&mut c, "买牛奶 #todo").unwrap();
    let legacy = seed_legacy(&c, "v1.0");
    let legacy2 = seed_legacy(&c, "看电影."); // 句末点仍不可解析,走既有 tag_id 分支
    c.execute(
        "INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'note', ?2), (?3, 'note', ?2)",
        rusqlite::params![legacy, n.id, legacy2],
    )
    .unwrap();
    assert_eq!(crate::tags::parse_tag_path("v1.0"), Some(vec!["v1.0".to_string()]));
    assert!(crate::tags::parse_tag_path("看电影.").is_none(), "前提:句末点不可解析");

    let done = notes::toggle_todo(&mut c, n.id).unwrap().unwrap();
    assert!(done.tags.contains(&"done".to_string()), "todo -> done");
    assert!(!done.tags.contains(&"todo".to_string()));
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={legacy}")),
        1,
        "存量标签节点不得被删"
    );
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={legacy} AND target_id={}", n.id)),
        1,
        "存量链接必须仍在"
    );
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={legacy2} AND target_id={}", n.id)),
        1,
        "不可解析的存量链接也必须仍在"
    );
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE path='done'")), 1);

    // 再切回来同样成功
    let todo = notes::toggle_todo(&mut c, n.id).unwrap().unwrap();
    assert!(todo.tags.contains(&"todo".to_string()));
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={legacy} AND target_id={}", n.id)),
        1
    );
    assert!(crate::db::repos::notes::query(
        &c,
        &crate::db::repos::notes::FilterConditions {
            keyword: Some("v1.0".into()),
            ..crate::db::repos::notes::notes_filter::empty()
        },
        0,
    )
    .unwrap()
    .iter()
    .any(|x| x.id == n.id));
}
