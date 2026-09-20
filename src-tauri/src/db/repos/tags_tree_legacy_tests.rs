//! 存量标签在结构变更/查询路径上的边界(修复轮 1):改名派生、幻影前缀、空容器回收、错误文案。
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

/// 模拟 006 原样保留的存量平铺根(name == path,parent NULL,depth 1)
fn seed_legacy(c: &Connection, name: &str) -> i64 {
    c.execute(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES(?1, NULL, ?1, 1)",
        [name],
    )
    .unwrap();
    id_at(c, name)
}

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

/// Warning 1:改名必须从父节点派生新路径 —— 存量平铺根不得派生出幻影前缀
#[test]
fn rename_legacy_flat_root_does_not_create_phantom_prefix() {
    let mut c = db();
    let legacy = seed_legacy(&c, "a/b");

    rename(&mut c, legacy, "c").unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 1);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tags WHERE name='c' AND path='c' AND depth=1 AND parent_id IS NULL"),
        1,
        "根行 path 必须等于 name"
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='a/c'"), 0, "不得留下幻影前缀");
    assert_eq!(query::complete(&c, "a/").unwrap(), Vec::<String>::new());
    assert_eq!(query::complete(&c, "c").unwrap(), vec!["c"]);
}

/// 存量行必须带链接或子节点,否则会被 gc_orphans(create/link_paths 收尾)回收掉
fn seed_legacy_linked(c: &Connection, name: &str, note_id: i64) -> i64 {
    let id = seed_legacy(c, name);
    c.execute(
        "INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'note', ?2)",
        rusqlite::params![id, note_id],
    )
    .unwrap();
    id
}

/// Warning 1 衍伸:改名撞上被存量行占用的 path 时给中文文案,不暴露 sqlite 原生错误
#[test]
fn rename_into_legacy_path_reports_chinese_error() {
    let mut c = db();
    let n = notes::create_plain(&mut c, "x #工作/项目A").unwrap();
    seed_legacy_linked(&c, "事业/项目A", n.id);
    let before = dump(&c);

    let work = id_at(&c, "工作");
    let err = rename(&mut c, work, "事业").unwrap_err();

    assert_eq!(err, "已存在同名标签");
    assert!(!err.contains("UNIQUE"));
    assert_eq!(dump(&c), before, "失败整事务回滚");
}

/// 同上的移动路径:目标父级下没有同名子标签,但派生出的完整路径已被存量行占用
#[test]
fn move_into_legacy_path_reports_chinese_error() {
    let mut c = db();
    notes::create_plain(&mut c, "x #工作/项目A").unwrap();
    let n = notes::create_plain(&mut c, "y #生活").unwrap();
    seed_legacy_linked(&c, "生活/项目A", n.id);
    let before = dump(&c);

    let leaf = id_at(&c, "工作/项目A");
    let life = id_at(&c, "生活");
    let err = move_to(&mut c, leaf, Some(life)).unwrap_err();

    assert_eq!(err, "该层级下已有同名标签");
    assert!(!err.contains("UNIQUE"));
    assert_eq!(dump(&c), before);
}

/// Warning 2:删除子标签后,变成空容器的祖先一并回收(与 link_paths 同一口径)
#[test]
fn delete_subtree_recycles_emptied_ancestor() {
    let mut c = db();
    let n = notes::create_plain(&mut c, "x #工作/项目A").unwrap();
    let leaf = id_at(&c, "工作/项目A");

    delete_subtree(&mut c, leaf).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 0, "工作 无链接且无子节点 -> 一并回收");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links"), 0);
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM notes WHERE id={}", n.id)), 1);
}

/// Warning 2 反向:仍有其它子节点、或自己直链笔记的容器必须保留
#[test]
fn delete_subtree_keeps_container_still_in_use() {
    let mut c = db();
    notes::create_plain(&mut c, "x #工作/项目A").unwrap();
    notes::create_plain(&mut c, "y #工作/项目B").unwrap();
    notes::create_plain(&mut c, "z #生活").unwrap();
    notes::create_plain(&mut c, "w #生活/子").unwrap();

    let pa = id_at(&c, "工作/项目A");
    let lz = id_at(&c, "生活/子");
    delete_subtree(&mut c, pa).unwrap();
    delete_subtree(&mut c, lz).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作'"), 1, "还有子节点");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作/项目B'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作/项目A'"), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='生活'"), 1, "自己直链笔记");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='生活/子'"), 0);
}

/// 小项:impact 对不存在的 tag_id 报错(与 delete_subtree 同口径)
#[test]
fn impact_missing_tag_reports_error() {
    let mut c = db();
    notes::create_plain(&mut c, "x #工作/项目A").unwrap();

    assert!(impact(&c, id_at(&c, "工作")).is_ok());
    let err = impact(&c, 9999).unwrap_err();
    assert!(err.to_string().contains("9999"));
}
