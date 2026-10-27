//! 线语义词汇表的用例 + **全仓普查守卫**(架构精简 A)。
//!
//! 守卫的目的:线上判据只允许写到 033 视图与 `line_kind.rs` 两处;别处再出现
//! `name_id IS NULL` / `name_id = 0` 的字面量就红 —— 否则这次收口三个月后又散回去。
//! 迁移 SQL 与对账脚本按设计要直接写判据(它们定义的就是"什么是树线"),列在豁免清单里。
use super::*;
use std::path::{Path, PathBuf};

#[test]
fn name_id_picks_the_right_view() {
    assert_eq!(view_for_name_id(None), "tag_lines");
    assert_eq!(view_for_name_id(Some(0)), "tree_lines");
    assert_eq!(view_for_name_id(Some(2120)), "relation_lines"); // 2120 = 名字点「状态」
}

/// 003 号视图必须存在且语义与判据一致(在内存库里跑真迁移到最新版)
#[test]
fn views_exist_and_match_the_predicates() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::db::sql_functions::register(&conn).unwrap();
    crate::db::migrate::run(&conn).unwrap();
    for view in [TAG_LINES, TREE_LINES, "relation_lines", NON_TREE_LINES] {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='view' AND name=?1",
                [view],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "视图 {view} 应存在(迁移 033)");
    }
    // 三条视图互斥且并集 = 全表
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM lines", [], |r| r.get(0)).unwrap();
    let parts: i64 = conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM tag_lines) + (SELECT COUNT(*) FROM tree_lines) \
                   + (SELECT COUNT(*) FROM relation_lines)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(total, parts, "tag/tree/relation 应恰好三分 lines");
    let non_tree: i64 = conn
        .query_row("SELECT COUNT(*) FROM non_tree_lines", [], |r| r.get(0))
        .unwrap();
    let tag_plus_rel: i64 = conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM tag_lines) + (SELECT COUNT(*) FROM relation_lines)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(non_tree, tag_plus_rel);
}

fn src_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

/// 豁免:定义处、迁移 SQL、对账、以及本文件自己
fn is_exempt(rel: &str) -> bool {
    rel.contains("line_kind")
        || rel.contains("migrations/")
        || rel.contains("reconcile")
        || rel.contains("library_migrate")
        || rel.contains("sql_functions")
}

/// 扫描 `src/**/*.rs`,统计"手写线判据"的处数,超预算即红。
///
/// 预算的意义:今天是 X 处历史存量,不能一夜清完;但**不允许再涨**。
/// 每轮收口把预算调低一次,直到 0。
#[test]
fn handwritten_line_predicates_only_shrink() {
    // 2026-10-27 首轮收口后实测 172 处(原 184);预算贴着当前值,涨一处就红
    const BUDGET: usize = 172;
    let mut hits: Vec<(String, usize)> = Vec::new();
    let mut total = 0usize;
    let mut stack = vec![src_root()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let p = entry.unwrap().path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            if p.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let rel = p
                .strip_prefix(src_root())
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if is_exempt(&rel) {
                continue;
            }
            let body = std::fs::read_to_string(&p).unwrap();
            // 只数"代码里的判据",注释里的说明不算(块注释与行注释先剥掉)
            let code: String = body
                .lines()
                .filter(|l| !l.trim_start().starts_with("//"))
                .collect::<Vec<_>>()
                .join("\n");
            let n = code.matches("name_id IS NULL").count() + code.matches("name_id = 0").count();
            if n > 0 {
                total += n;
                hits.push((rel, n));
            }
        }
    }
    hits.sort_by_key(|h| std::cmp::Reverse(h.1));
    if total > BUDGET {
        panic!(
            "手写线判据 {total} 处,超过预算 {BUDGET};请改用 tag_lines/tree_lines/non_tree_lines。\
             大头:{:?}",
            hits.iter().take(3).collect::<Vec<_>>()
        );
    }
}
