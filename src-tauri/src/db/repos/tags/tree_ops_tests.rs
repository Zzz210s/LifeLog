//! 标签树结构操作测试(测试先行):rename / move_to / impact / delete_subtree。
//! 失败路径必须整事务回滚(结构快照逐行比对)。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::{self, notes_filter::*, query};
use crate::db::repos::tags::invariants_tests::{
    assert_fts_matches_tags, assert_no_orphan_tags, assert_tabs_paths_exist,
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
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0))
        .unwrap()
}

fn segs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
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

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 2);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='事业' AND name='事业' AND depth=1 AND parent_id IS NULL"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='事业/项目A' AND name='项目A' AND depth=2 AND parent_id=(SELECT id FROM tags WHERE path='事业')"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path IN ('工作','工作/项目A')"), 0);
    // FTS 聚合的是完整路径:新路径可搜、旧路径不再命中
    // (父级名称本身不直链笔记,2 字符关键词按标签名匹配不会命中父级)
    assert_eq!(hits(&c, "会议记录"), 1);
    assert_eq!(hits(&c, "事业/项目A"), 1);
    assert_eq!(hits(&c, "工作/项目A"), 0);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
    assert_tabs_paths_exist(&c);
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
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE path='生活/项目A' AND name='项目A' AND depth=2 AND parent_id={life2}")), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作/项目A'"), 0);
    assert_eq!(hits(&c, "生活/项目A"), 1);
    assert_eq!(hits(&c, "工作/项目A"), 0);

    move_to(&mut c, leaf, None).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='项目A' AND depth=1 AND parent_id IS NULL"), 1);
    assert_eq!(hits(&c, "项目A"), 1);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
    assert_tabs_paths_exist(&c);
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
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM notes_fts"), 1);
}

/// ⑩ 超过深度上限的移动被拒绝且不改库(与解析器 MAX_DEPTH 同一不变量)
#[test]
fn move_beyond_max_depth_rejected_and_db_untouched() {
    let mut c = db();
    ensure_path(&c, &segs(&["a1", "a2", "a3", "a4", "a5"])).unwrap();
    ensure_path(&c, &segs(&["x"])).unwrap();
    let before = dump(&c);

    let a1 = id_at(&c, "a1");
    let x = id_at(&c, "x");
    assert!(move_to(&mut c, a1, Some(x)).is_err());

    assert_eq!(dump(&c), before);
    assert_eq!(crate::tags::max_depth(), 5);
}

/// ⑥ 同级重名:改名与移动都要拒绝,且原标签保持可用
#[test]
fn same_level_duplicate_rejected() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作").unwrap();
    notes::create_plain(&mut c, "b #生活").unwrap();
    notes::create_plain(&mut c, "c #工作/项目A").unwrap();
    notes::create_plain(&mut c, "d #项目A").unwrap();
    let life = id_at(&c, "生活");
    let other = id_at(&c, "项目A");

    let work = id_at(&c, "工作");
    assert!(rename(&mut c, life, "工作").is_err(), "根级已有同名标签");
    assert!(move_to(&mut c, other, Some(work)).is_err(), "目标父级下已有同名子标签");

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='生活' AND name='生活'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='项目A' AND parent_id IS NULL"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作/项目A'"), 1);
    assert!(rename(&mut c, life, "工作 计划").is_err(), "非法的标签名一律拒绝");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='生活'"), 1);
    // 失败路径整事务回滚,库内不变量必须依然成立
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// ⑦ 删除子树:父与子一并删除、链接解除、笔记保留、FTS 不再含该路径
#[test]
fn delete_subtree_removes_tags_keeps_notes() {
    let mut c = db();
    notes::create_plain(&mut c, "纪要 #工作/项目A").unwrap();
    let root = id_at(&c, "工作");

    assert_eq!(impact(&c, root).unwrap(), (1, 1));
    assert_eq!(impact(&c, id_at(&c, "工作/项目A")).unwrap(), (0, 1));

    delete_subtree(&mut c, root).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links"), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM notes"), 1);
    assert_eq!(hits(&c, "项目A"), 0);
    assert_eq!(hits(&c, "纪要"), 1);
    // 删除不改写 tabs_state(S7),故只断言 FTS 与孤儿两项
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// ⑩ 删除不存在的标签:报错且整事务回滚(空操作不落库)
#[test]
fn delete_missing_tag_rolls_back() {
    let mut c = db();
    notes::create_plain(&mut c, "x #工作/项目A").unwrap();
    let before = dump(&c);
    assert!(delete_subtree(&mut c, 9999).is_err());
    assert_eq!(dump(&c), before);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links"), 1);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}
