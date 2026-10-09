//! 同父同名自动合并测试(续,自动合并 core 见 auto_merge_tests.rs):
//! 失败整体回滚、md 写法差异也判同名、无重名空操作、改名撞兄弟 raw 名。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes;
use crate::db::repos::tags::invariants_tests::{assert_fts_matches_edges, assert_no_orphan_tags};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    crate::db::repos::tags::test_support::install_entity_views(&c);
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0)).unwrap()
}

fn segs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn links(c: &Connection, tag_id: i64) -> i64 {
    count(
        c,
        &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={tag_id} AND target_type='note'"),
    )
}

fn snapshot(c: &Connection) -> String {
    let rows = |sql: &str| -> Vec<String> {
        let mut stmt = c.prepare(sql).unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    format!(
        "{:?}\n{:?}\n{:?}",
        rows("SELECT id||'|'||name||'|'||COALESCE(parent_id,0)||'|'||path||'|'||depth FROM tags ORDER BY id"),
        rows("SELECT tag_id||'|'||target_type||'|'||target_id FROM tag_links ORDER BY tag_id,target_type,target_id"),
        rows("SELECT source_entity_id||'|'||target_entity_id||'|'||note_links FROM entity_merge_log ORDER BY id"),
    )
}

/// ⑤ 失败整体回滚:删除被触发器拒绝 -> 源标签、链接、日志全部原样
#[test]
fn merge_failure_rolls_back_whole_transaction() {
    let mut c = db();
    let p = ensure_path(&c, &segs(&["P"])).unwrap();
    notes::create_plain(&mut c, "a #P/A").unwrap();
    notes::create_plain(&mut c, "b #Q/A").unwrap();
    let moved = id_at(&c, "Q/A");
    c.execute_batch(&format!(
        "CREATE TRIGGER boom BEFORE DELETE ON entities
           WHEN OLD.kind = 'tag' AND OLD.id = {moved}
         BEGIN SELECT RAISE(ABORT, 'boom'); END;"
    ))
    .unwrap();
    let before = snapshot(&c);

    let err = move_to(&mut c, moved, Some(p)).unwrap_err();

    assert!(!err.is_empty(), "报错非空: {err}");
    assert_eq!(snapshot(&c), before, "整段回滚,零变化");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entity_merge_log"), 0, "日志也不落地");
    assert_fts_matches_edges(&c);
}

/// ⑥ md 写法与纯文本**不再**自动合并:三重闸门(spec §3.6 / §10-P0-3)要求两侧 `meta`
/// 逐字节相等,md 差异只登记纯文本别名(旧「纯文本同名即并」的行为已被 P0-3 取消)。
#[test]
fn md_variant_is_not_merged_and_registers_plain_alias() {
    let mut c = db();
    notes::create_plain(&mut c, "a #P/郴州市").unwrap();
    notes::create_plain(&mut c, "b #P/x").unwrap();
    let x = id_at(&c, "P/x");

    // 改名成 md 形态:raw 名与兄弟不同,ensure_sibling_free 放行 -> 收尾 sweep 发现纯文本同名
    rename(&mut c, x, "[郴](chēn)州市").unwrap();

    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={x}")), 1, "meta 不同 -> 不合并");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='P/郴州市'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='P/[郴](chēn)州市'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entity_merge_log"), 0, "三重闸门未过 -> 无合并日志");
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tag_aliases WHERE alias='郴州市'"),
        1,
        "纯文本形态登记为别名"
    );
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
}

/// ⑦ 无重名时空操作:标签与日志都不动
#[test]
fn sweep_without_duplicates_is_noop() {
    let mut c = db();
    notes::create_plain(&mut c, "a #P/甲").unwrap();
    notes::create_plain(&mut c, "b #P/乙").unwrap();
    let before = snapshot(&c);

    assert_eq!(auto_merge::sweep(&c).unwrap(), 0);

    assert_eq!(snapshot(&c), before);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entity_merge_log"), 0);
}

/// ⑨ 整棵并时子级 raw 撞名:两棵子树各自的同名子标签也递归并(唯一索引不允许两行同名兄弟)
#[test]
fn merge_recursively_merges_colliding_children() {
    let mut c = db();
    notes::create_plain(&mut c, "a #源/子").unwrap();
    notes::create_plain(&mut c, "b #目标/子").unwrap();
    let src = id_at(&c, "源");
    let dst = id_at(&c, "目标");
    let src_child = id_at(&c, "源/子");
    let target_child = id_at(&c, "目标/子");

    merge_tags(&mut c, src, dst, false).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='目标/子'"), 1);
    assert_eq!(links(&c, target_child), 2, "两棵子树的笔记并到同一个子标签");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path LIKE '源%'"), 0, "旧子树无残留");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entity_merge_log"), 1, "嵌套的自动合并留一条日志(外层是手动合并,不记)");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM entity_merge_log WHERE source_entity_id={src_child} AND target_entity_id={target_child}")), 1);
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
}

/// ⑩ 改名撞上兄弟 raw 名:不报错,改为自动合并(源是被改名者)
#[test]
fn rename_onto_existing_sibling_merges() {
    let mut c = db();
    notes::create_plain(&mut c, "a #P/甲").unwrap();
    notes::create_plain(&mut c, "b #P/乙").unwrap();
    let jia = id_at(&c, "P/甲");

    rename(&mut c, jia, "乙").unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='P/乙'"), 1);
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={jia}")), 0, "被改名者并入");
    assert_eq!(links(&c, id_at(&c, "P/乙")), 2);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entity_merge_log"), 1);
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
}
