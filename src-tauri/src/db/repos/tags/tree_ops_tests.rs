//! 标签树结构操作测试(测试先行):rename / move_to / impact / delete_subtree。
//! 失败路径必须整事务回滚(结构快照逐行比对)。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::{self, notes_filter::*, query as query_all};
use crate::db::repos::tags::invariants_tests::{
    assert_fts_matches_edges, assert_no_orphan_tags, assert_filter_paths_exist,
};
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

/// 标签表全量快照(按 id 排序),用于"不改库"断言
fn dump(c: &Connection) -> Vec<String> {
    let mut stmt = c
        .prepare("SELECT id, entity_name(meta), COALESCE(parent_id, 0), path, depth FROM entities WHERE path IS NOT NULL ORDER BY id")
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

fn hits(c: &Connection, kw: &str) -> usize {
    query(
        c,
        &FilterConditions { keyword: Some(kw.into()), ..empty() },
        0,
    )
    .unwrap()
    .len()
}

/// ③ 改父级名:子树的 path 前缀整体重写,深度与末级名不变,FTS 同步
#[test]
fn rename_updates_whole_subtree_paths_and_fts() {
    let mut c = db();
    notes::create_plain(&mut c, "会议记录 #工作/项目A").unwrap();
    let root = id_at(&c, "工作");

    rename(&mut c, root, "事业").unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL"), 2);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='事业' AND entity_name(meta)='事业' AND depth=1 AND parent_id IS NULL"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='事业/项目A' AND entity_name(meta)='项目A' AND depth=2 AND parent_id=(SELECT id FROM entities WHERE path IS NOT NULL AND path='事业')"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path IN ('工作','工作/项目A')"), 0);
    // FTS 聚合的是完整路径:新路径可搜、旧路径不再命中
    // (父级名称本身不直链笔记,2 字符关键词按标签名匹配不会命中父级)
    assert_eq!(hits(&c, "会议记录"), 1);
    assert_eq!(hits(&c, "事业/项目A"), 1);
    assert_eq!(hits(&c, "工作/项目A"), 0);
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
    assert_filter_paths_exist(&c);
}

/// ④ 移动:父子关系、path、depth 同步更新(含移回根级)
#[test]
fn move_to_reparents_and_rewrites_paths() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作/项目A").unwrap();
    notes::create_plain(&mut c, "b #生活").unwrap();
    let leaf = id_at(&c, "工作/项目A");
    let life = id_at(&c, "生活");

    move_to(&mut c, leaf, Some(life)).unwrap();

    let life2 = id_at(&c, "生活");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='生活/项目A' AND entity_name(meta)='项目A' AND depth=2 AND parent_id={life2}")), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='工作/项目A'"), 0);
    assert_eq!(hits(&c, "生活/项目A"), 1);
    assert_eq!(hits(&c, "工作/项目A"), 0);

    move_to(&mut c, leaf, None).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='项目A' AND depth=1 AND parent_id IS NULL"), 1);
    assert_eq!(hits(&c, "项目A"), 1);
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
    assert_filter_paths_exist(&c);
}

/// ⑤+⑩ 移动到自身/自身子树被拒绝,失败路径整事务回滚(结构逐行不变)
#[test]
fn move_into_own_subtree_rejected_and_db_untouched() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作/项目A").unwrap();
    let root = id_at(&c, "工作");
    let leaf = id_at(&c, "工作/项目A");
    let before = dump(&c);

    assert!(move_to(&mut c, root, Some(leaf)).is_err());
    assert!(move_to(&mut c, root, Some(root)).is_err());

    assert_eq!(dump(&c), before);
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM edges e JOIN entities s ON s.id = e.source_id JOIN entities t ON t.id = e.target_id WHERE e.kind = 'link' AND s.path IS NULL AND t.path IS NOT NULL AND e.target_id = (SELECT id FROM entities WHERE path IS NOT NULL AND path='工作/项目A')"
        ),
        1,
        "笔记 -> 叶子标签的那条链接仍在"
    );
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM entities_fts WHERE meta <> ''
               AND rowid IN (SELECT id FROM entities WHERE path IS NULL)"
        ),
        1,
        "只有笔记有正文"
    );
}

/// 统一元数据后 `query` 的域是全实体(spec §4.1:清空筛选即显示标签);
/// 本文件的老用例只关心迁移前的「全部笔记」,故把默认筛选并入条件(见 test_support)。
fn query(
    c: &Connection,
    cond: &crate::db::repos::notes::notes_filter::FilterConditions,
    offset: i64,
) -> Result<Vec<crate::db::repos::notes::Note>, String> {
    query_all(c, &crate::db::repos::tags::test_support::with_note_domain(cond.clone()), offset)
}

#[path = "tree_ops_delete_tests.rs"]
mod tree_ops_delete_tests;
