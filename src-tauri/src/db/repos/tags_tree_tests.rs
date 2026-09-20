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
    assert_eq!(query::complete(&c, "工").unwrap(), vec!["工作", "工作/项目A"]);
    assert_eq!(query::complete(&c, "工作/").unwrap(), vec!["工作/项目A"]);
    assert_eq!(query::complete(&c, "a%").unwrap(), vec!["a%b"]);
    assert!(query::complete(&c, "无此").unwrap().is_empty());
    // 带别名的补全(G3)在同一库上只多出 kind 字段:无别名时与纯路径版本逐项同序
    let items: Vec<String> = complete_with_aliases(&c, "工")
        .unwrap()
        .into_iter()
        .map(|i| i.path)
        .collect();
    assert_eq!(items, vec!["工作", "工作/项目A"]);
}

/// C-2(直调):库里已有 待定/TBD 根标签时,ensure_path 必须就地和解成两级树
#[test]
fn ensure_path_reconciles_legacy_flat_name_with_slash() {
    let c = db();
    // 006 迁移把存量标签原样保留为根:name == path == '待定/TBD',depth=1,parent=NULL
    c.execute(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES('待定/TBD', NULL, '待定/TBD', 1)",
        [],
    )
    .unwrap();
    let legacy = id_at(&c, "待定/TBD");

    let leaf = ensure_path(&c, &segs(&["待定", "TBD"])).unwrap();

    // 复用旧行 id(其链接不丢),身份规整为第二级;而不是静默复用根身份或报错
    assert_eq!(leaf, legacy);
    let root = id_at(&c, "待定");
    assert_ne!(root, legacy);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tags WHERE id=(SELECT id FROM tags WHERE path='待定/TBD') AND name='TBD' AND depth=2 AND parent_id=(SELECT id FROM tags WHERE path='待定')"),
        1
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='待定' AND name='待定' AND depth=1 AND parent_id IS NULL"), 1);
    // 幂等:再调一次不再变化
    let before = dump(&c);
    assert_eq!(ensure_path(&c, &segs(&["待定", "TBD"])).unwrap(), leaf);
    assert_eq!(dump(&c), before);
}

/// C-2(端到端):保存 #待定/TBD 时不得静默复用旧根行,结果必须是两级树且链接在末端
#[test]
fn create_with_legacy_flat_name_builds_two_level_tree() {
    let mut c = db();
    c.execute(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES('待定/TBD', NULL, '待定/TBD', 1)",
        [],
    )
    .unwrap();
    let n = notes::create_plain(&mut c, "记一笔 #待定/TBD").unwrap();
    assert_eq!(n.tags, vec!["待定/TBD"]);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 2);
    let leaf = id_at(&c, "待定/TBD");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE parent_id={leaf}")), 0);
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={leaf} AND target_id={} AND target_type='note'", n.id)),
        1
    );
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={} ", id_at(&c, "待定"))), 0);
    assert_eq!(hits(&c, "待定/TBD"), 1);
}

/// 孤儿回收收窄:有子节点的父节点不得回收;整条无用链(叶->父)逐层回收
#[test]
fn gc_orphans_keeps_parents_with_children_and_prunes_dead_chain() {
    let mut c = db();
    ensure_path(&c, &segs(&["a", "b"])).unwrap();
    let n = notes::create_plain(&mut c, "x #a/b").unwrap();
    assert_eq!(id_at(&c, "a/b"), ensure_path(&c, &segs(&["a", "b"])).unwrap());

    gc_orphans(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 2, "父节点有子节点,不是孤儿");

    // 解链后叶与父逐层收敛回收
    c.execute("DELETE FROM tag_links WHERE target_id=?1 AND target_type='note'", [n.id])
        .unwrap();
    gc_orphans(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 0);
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0))
        .unwrap()
}
