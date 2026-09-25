//! 标签合并仓库层核心测试(spec 2026-09-20 §3.4 / D5-D6):链接转移、唯一键冲突去重、
//! 三类校验失败整事务回滚(逐行快照比对)、别名开关。级联与 FTS 见 extra 文件。
use super::*;
use crate::db::migrate;
use crate::db::repos::{notes, tags::alias};
use crate::db::repos::tags::invariants_tests::{
    assert_fts_matches_tags, assert_no_orphan_tags, assert_filter_paths_exist,
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

fn rows(c: &Connection, sql: &str) -> Vec<String> {
    let mut stmt = c.prepare(sql).unwrap();
    let it = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
    it.collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

/// 全库快照(tags / tag_links / tag_aliases / notes_fts / settings 逐行),用于"零变化"断言
fn snapshot(c: &Connection) -> String {
    let tags = rows(c, "SELECT id||'|'||name||'|'||COALESCE(parent_id,0)||'|'||path||'|'||depth FROM tags ORDER BY id");
    let links = rows(c, "SELECT tag_id||'|'||target_type||'|'||target_id FROM tag_links ORDER BY tag_id, target_type, target_id");
    let aliases = rows(c, "SELECT alias||'|'||tag_id FROM tag_aliases ORDER BY alias");
    let fts = rows(c, "SELECT rowid||'|'||tags FROM notes_fts ORDER BY rowid");
    let settings = rows(c, "SELECT key||'|'||value FROM settings ORDER BY key");
    format!("{tags:?}\n{links:?}\n{aliases:?}\n{fts:?}\n{settings:?}")
}

fn link_count(c: &Connection, tag_id: i64, note_id: i64) -> i64 {
    count(
        c,
        &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={tag_id} AND target_type='note' AND target_id={note_id}"),
    )
}

/// ① 链接转移:源的 3 条笔记全落到目标上,源节点消失,标签总数 -1
#[test]
fn merge_moves_all_links_and_deletes_source() {
    let mut c = db();
    for content in ["a #源", "b #源", "c #源"] {
        notes::create_plain(&mut c, content).unwrap();
    }
    notes::create_plain(&mut c, "d #目标").unwrap();
    let (src, dst) = (id_at(&c, "源"), id_at(&c, "目标"));
    let tags_before = count(&c, "SELECT COUNT(*) FROM tags");

    let r = merge_tags(&mut c, src, dst, false).unwrap();

    assert_eq!(r.moved_links, 3);
    assert_eq!(r.affected_notes, 3);
    assert!(r.aliases.is_empty());
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={dst}")), 4);
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={src}")), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='源'"), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), tags_before - 1);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// ② 唯一键冲突:一条笔记同时链了源与目标 -> 目标上只剩 1 条链接,moved_links 只算真改的行
#[test]
fn merge_dedupes_note_linked_to_both_tags() {
    let mut c = db();
    notes::create_plain(&mut c, "a #源").unwrap();
    let both = notes::create_plain(&mut c, "b #源 #目标").unwrap();
    let (src, dst) = (id_at(&c, "源"), id_at(&c, "目标"));

    let r = merge_tags(&mut c, src, dst, false).unwrap();

    assert_eq!(r.moved_links, 1, "只有 b 之外的那条链接真正改了 tag_id");
    assert_eq!(r.affected_notes, 2);
    assert_eq!(link_count(&c, dst, both.id), 1, "唯一键冲突行不产生重复链接");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={src}")), 0);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// ③ 源有子节点:中文报错且整事务回滚(全库快照逐行不变)
#[test]
fn source_with_children_rejected_and_rolls_back() {
    let mut c = db();
    notes::create_plain(&mut c, "a #源/子").unwrap();
    notes::create_plain(&mut c, "b #目标").unwrap();
    notes::create_plain(&mut c, "c #其它").unwrap();
    let (src, dst) = (id_at(&c, "源"), id_at(&c, "目标"));
    // 先让别名表与筛选条件有内容,验证失败时它们也不动
    alias::add(&c, "别名X", dst).unwrap();
    let before = snapshot(&c);

    let err = merge_tags(&mut c, src, dst, true).unwrap_err();

    assert_eq!(err, "该标签还有子标签,请先移走或合并子标签");
    assert_eq!(snapshot(&c), before);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// ④ 目标在源子树内:拒绝(子树检查先于子节点检查,给更精确的诊断)
#[test]
fn target_inside_source_subtree_rejected() {
    let mut c = db();
    notes::create_plain(&mut c, "a #源/子").unwrap();
    let (src, child) = (id_at(&c, "源"), id_at(&c, "源/子"));
    let before = snapshot(&c);

    let err = merge_tags(&mut c, src, child, false).unwrap_err();

    assert_eq!(err, "目标标签在源标签的子树内,不能合并");
    assert_eq!(snapshot(&c), before);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// ⑤ 源与目标相同:拒绝且不改库
#[test]
fn same_source_and_target_rejected() {
    let mut c = db();
    notes::create_plain(&mut c, "a #源").unwrap();
    let src = id_at(&c, "源");
    let before = snapshot(&c);

    let err = merge_tags(&mut c, src, src, true).unwrap_err();

    assert_eq!(err, "不能把标签合并到它自己");
    assert_eq!(snapshot(&c), before);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// ⑥ id 不存在:中文报错且不改库
#[test]
fn missing_tag_ids_rejected() {
    let mut c = db();
    notes::create_plain(&mut c, "a #源").unwrap();
    let src = id_at(&c, "源");
    let before = snapshot(&c);

    assert_eq!(merge_tags(&mut c, 9999, src, false).unwrap_err(), "源标签不存在: 9999");
    assert_eq!(merge_tags(&mut c, src, 9999, false).unwrap_err(), "目标标签不存在: 9999");
    assert_eq!(snapshot(&c), before);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// ⑦ keep_alias = true:旧完整路径与旧叶子名都登记到目标;解析回目标当前路径
#[test]
fn keep_alias_registers_old_path_and_leaf() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作/项目A").unwrap();
    notes::create_plain(&mut c, "b #事业").unwrap();
    let (src, dst) = (id_at(&c, "工作/项目A"), id_at(&c, "事业"));

    let r = merge_tags(&mut c, src, dst, true).unwrap();

    assert_eq!(r.aliases, vec!["工作/项目A".to_string(), "项目A".to_string()]);
    assert_eq!(alias::resolve(&c, "工作/项目A").unwrap().as_deref(), Some("事业"));
    assert_eq!(alias::resolve(&c, "项目A").unwrap().as_deref(), Some("事业"));
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_aliases"), 2);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
    assert_filter_paths_exist(&c);
}

/// ⑧ keep_alias = false:别名表保持为空(旧名不落地)
#[test]
fn keep_alias_false_leaves_alias_table_empty() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作/项目A").unwrap();
    notes::create_plain(&mut c, "b #事业").unwrap();
    let (src, dst) = (id_at(&c, "工作/项目A"), id_at(&c, "事业"));

    let r = merge_tags(&mut c, src, dst, false).unwrap();

    assert!(r.aliases.is_empty());
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_aliases"), 0);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
    assert_filter_paths_exist(&c);
}
