//! 同父同名自动合并测试(设计 2026-10-06 §6 / 计划 Task 2):
//! 拖入同名、改名撞名、md 差异但纯文本同名都自动整棵并;笔记链接与出/入边取并集;
//! 子标签整棵搬且 path/depth 正确;合并前写 tag_merge_log;失败整体回滚;无重名空操作。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes;
use crate::db::repos::tags::invariants_tests::{assert_fts_matches_tags, assert_no_orphan_tags};
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
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0)).unwrap()
}

fn segs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

/// 某标签链接的笔记数
fn links(c: &Connection, tag_id: i64) -> i64 {
    count(
        c,
        &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={tag_id} AND target_type='note'"),
    )
}

/// 关系边是否存在
fn has_edge(c: &Connection, from: i64, to: i64) -> bool {
    count(
        c,
        &format!(
            "SELECT COUNT(*) FROM tag_links WHERE target_type='tag' AND tag_id={from} AND target_id={to}"
        ),
    ) == 1
}

/// ① 拖入标签使其与兄弟同名:自动合并(源 = 被拖入者,目标 = 已在位者)
#[test]
fn drag_onto_same_name_sibling_merges() {
    let mut c = db();
    let p = ensure_path(&c, &segs(&["P"])).unwrap();
    let a = notes::create_plain(&mut c, "a #P/A").unwrap();
    let b = notes::create_plain(&mut c, "b #Q/A").unwrap();
    let keep = id_at(&c, "P/A");
    let moved = id_at(&c, "Q/A");

    // ensure_sibling_free 的旧行为在这里报错;新行为应整棵并到 P/A
    move_to(&mut c, moved, Some(p)).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='P/A'"), 1);
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={moved}")), 0, "源已删");
    assert_eq!(links(&c, keep), 2, "两侧笔记链接取并集");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={keep} AND target_type='note' AND target_id={}", a.id)), 1);
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE tag_id={keep} AND target_type='note' AND target_id={}", b.id)), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_merge_log"), 1, "自动合并写日志");
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// ② 子标签整棵搬:path 前缀重写 + depth 按层差调整
#[test]
fn merge_moves_child_subtree_paths_and_depths() {
    let mut c = db();
    notes::create_plain(&mut c, "a #P/源/子/孙").unwrap();
    notes::create_plain(&mut c, "b #目标").unwrap();
    let src = id_at(&c, "P/源");
    let dst = id_at(&c, "目标");
    let child = id_at(&c, "P/源/子");
    let grand = id_at(&c, "P/源/子/孙");

    merge_tags(&mut c, src, dst, false).unwrap();

    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={child}")), 1);
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={grand}")), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='目标/子'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='目标/子/孙'"), 1);
    assert_eq!(count(&c, "SELECT depth FROM tags WHERE id=(SELECT id FROM tags WHERE path='目标/子')"), 2);
    assert_eq!(count(&c, "SELECT depth FROM tags WHERE path='目标/子/孙'"), 3);
    assert_eq!(count(&c, "SELECT parent_id FROM tags WHERE id=(SELECT id FROM tags WHERE path='目标/子')"), dst);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path LIKE 'P/%'"), 0, "旧路径已无残留");
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// ③ 出边与入边取并集:源 → X 变成 目标 → X;Y → 源 变成 Y → 目标
#[test]
fn merge_unions_out_and_in_edges() {
    let mut c = db();
    notes::create_plain(&mut c, "a #源").unwrap();
    notes::create_plain(&mut c, "b #目标").unwrap();
    let src = id_at(&c, "源");
    let dst = id_at(&c, "目标");
    let x = ensure_path(&c, &segs(&["X"])).unwrap();
    let y = ensure_path(&c, &segs(&["Y"])).unwrap();
    set_tag_relation(&mut c, src, x, "").unwrap();
    set_tag_relation(&mut c, y, src, "").unwrap();

    merge_tags(&mut c, src, dst, false).unwrap();

    assert!(has_edge(&c, dst, x), "出边并到目标");
    assert!(has_edge(&c, y, dst), "入边并到目标");
    assert!(!has_edge(&c, src, x) && !has_edge(&c, y, src), "源侧无残留");
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}

/// ④ 日志:源/目标 id、搬走的子标签 id 列表、笔记链接数都落库
#[test]
fn auto_merge_log_records_moved_children_and_links() {
    let mut c = db();
    notes::create_plain(&mut c, "a #P/郴州市").unwrap();
    let plain = id_at(&c, "P/郴州市");
    // 子标签带一条笔记链接(否则会被 replace_links 的孤儿回收删掉)
    notes::create_plain(&mut c, "b #P/md/宜章县").unwrap();
    let src = id_at(&c, "P/md");
    let child = id_at(&c, "P/md/宜章县");

    // 改名成 md 形态(纯文本仍是 郴州市):raw 名与兄弟不同 -> 收尾 sweep 自动合并
    rename(&mut c, src, "[郴](chēn)州市").unwrap();

    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={src}")), 0);
    let (s, d, kids): (i64, i64, String) = c
        .query_row(
            "SELECT source_tag_id, target_tag_id, moved_child_ids FROM tag_merge_log",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(s, src, "源 = md 形态");
    assert_eq!(d, plain, "目标 = 先建的纯文本形态(保留较小 id)");
    assert_eq!(kids, format!("[{child}]"), "搬走的子标签 id 列表");
    assert_eq!(count(&c, "SELECT note_links FROM tag_merge_log"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='P/郴州市/宜章县'"), 1);
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
}
