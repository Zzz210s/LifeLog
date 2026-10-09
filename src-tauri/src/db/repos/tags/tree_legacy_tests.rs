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
    c.query_row("SELECT id FROM entities WHERE path IS NOT NULL AND path=?1", [path], |r| r.get(0))
        .unwrap()
}

/// 模拟 006 原样保留的存量平铺根(name == path,parent NULL,depth 1)
fn seed_legacy(c: &Connection, name: &str) -> i64 {
    ensure_path(c, &[name.to_string()]).unwrap()
}

/// Warning 1:改名必须从父节点派生新路径 —— 存量平铺根不得派生出幻影前缀
#[test]
fn rename_legacy_flat_root_does_not_create_phantom_prefix() {
    let mut c = db();
    let legacy = seed_legacy(&c, "a/b");

    rename(&mut c, legacy, "c").unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL"), 1);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND entity_name(meta)='c' AND path='c' AND depth=1 AND parent_id IS NULL"),
        1,
        "根行 path 必须等于 name"
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='a/c'"), 0, "不得留下幻影前缀");
    assert_eq!(complete(&c, "a/").unwrap(), Vec::<String>::new());
    assert_eq!(complete(&c, "c").unwrap(), vec!["c"]);
}

/// 存量行必须带链接或子节点,否则会被 gc_orphans(create/link_paths 收尾)回收掉
fn seed_legacy_linked(c: &Connection, name: &str, note_id: i64) -> i64 {
    let id = seed_legacy(c, name);
    link_note(c, note_id, id).unwrap();
    id
}

/// P0-1 起 `idx_entities_path` 非唯一:改名派生出的完整路径撞上存量平铺行时**不再报错**
/// (寻址一律按 `parent_id` 逐段比较,不读 `path`;存量行由 C-2 和解在下次按该路径写入时就地规整)。
#[test]
fn rename_into_legacy_path_no_longer_errors() {
    let mut c = db();
    let n = notes::create_plain(&mut c, "x #工作/项目A").unwrap();
    seed_legacy_linked(&c, "事业/项目A", n.id);

    let work = id_at(&c, "工作");
    rename(&mut c, work, "事业").unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='事业' AND entity_name(meta)='事业'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path LIKE '工作%'"), 0, "旧路径不残留");
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='事业/项目A'"),
        2,
        "派生路径与存量平铺行同名:path 只是显示缓存(P0-1),两行并存"
    );
}

/// 同上的移动路径:P0-1 后同样不再报错(路径非唯一,寻址按 `parent_id` 逐段比较)。
#[test]
fn move_into_legacy_path_no_longer_errors() {
    let mut c = db();
    notes::create_plain(&mut c, "x #工作/项目A").unwrap();
    let n = notes::create_plain(&mut c, "y #生活").unwrap();
    seed_legacy_linked(&c, "生活/项目A", n.id);

    let leaf = id_at(&c, "工作/项目A");
    let life = id_at(&c, "生活");
    move_to(&mut c, leaf, Some(life)).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='工作/项目A'"), 0);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='生活/项目A'"),
        2,
        "搬来的子树与存量平铺行同名:path 只是显示缓存(P0-1)"
    );
}

/// Warning 2:删除子标签后,变成空容器的祖先一并回收(与 link_paths 同一口径)
#[test]
fn delete_subtree_recycles_emptied_ancestor() {
    let mut c = db();
    let n = notes::create_plain(&mut c, "x #工作/项目A").unwrap();
    let leaf = id_at(&c, "工作/项目A");

    delete_subtree(&mut c, leaf).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL"), 0, "工作 无链接且无子节点 -> 一并回收");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges e JOIN entities s ON s.id = e.source_id JOIN entities t ON t.id = e.target_id WHERE e.kind = 'link' AND (s.path IS NOT NULL OR t.path IS NOT NULL)"), 0);
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM entities WHERE path IS NULL AND id={}", n.id)), 1);
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

    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='工作'"), 1, "还有子节点");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='工作/项目B'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='工作/项目A'"), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='生活'"), 1, "自己直链笔记");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='生活/子'"), 0);
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
