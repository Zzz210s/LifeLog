//! 标签写入不变量测试台(spec 2026-09-21 D:标签写入路径收敛)。五组判据复用:
//! ① [`assert_fts_matches_edges`]:points_fts.paths == 视图 points_fts_src(唯一真源
//!    [`crate::db::repos::entities::fts::POINTS_AGG`],纯名字点天然无行)。
//! ①b [`assert_is_cited_matches_edges`]:`points.is_cited` == 有入**非子级线**(spec §3.1)。
//! ② [`assert_no_orphan_tags`]:无孤儿标签(无引用线且无子节点)。
//! ③ [`assert_filter_paths_exist`]:filter_current 引用的每个标签路径都存在;只对“路径变化”类
//!    操作断言(删除按设计不改写条件 S7,留已删路径允许)。
//! ④ [`assert_no_dangling_carries`]:'tag' 行的 to_id 都指向存在的标签。
//! ⑤ [`assert_carry_acyclic`]:携带图无环(S3)。
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY};
use crate::expr::lexer::{lex_spans, Token};
use rusqlite::{params, Connection, OptionalExtension};

/// ① 逐点比对 points_fts.paths(与视图 points_fts_src 同口径);失败信息带点 id。
/// 纯名字点不进 FTS(视图 WHERE 排除),两侧都是 None。
pub(crate) fn assert_fts_matches_edges(conn: &Connection) {
    let mut stmt = conn.prepare("SELECT id FROM points ORDER BY id").unwrap();
    let ids: Vec<i64> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    for id in ids {
        let expected: Option<String> = conn
            .query_row("SELECT paths FROM points_fts_src WHERE id = ?1", params![id], |r| r.get(0))
            .optional()
            .unwrap();
        let actual: Option<String> = conn
            .query_row("SELECT paths FROM points_fts WHERE rowid = ?1", params![id], |r| {
                r.get(0)
            })
            .optional()
            .unwrap();
        assert_eq!(
            actual, expected,
            "点 {id} 的 points_fts.paths 与视图 points_fts_src 不一致"
        );
    }
    let stale: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT rowid FROM points_fts WHERE rowid NOT IN (SELECT id FROM points_fts_src) ORDER BY rowid")
            .unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    assert!(stale.is_empty(), "points_fts 残留不在视图里的点行: {stale:?}");
}

/// ①b `is_cited` 与入**非子级线**一致(与对账 §3.7 第 1 条同口径):
/// 失败信息列出全部漂移点 id(子级线不算引用)。
pub(crate) fn assert_is_cited_matches_edges(conn: &Connection) {
    let drift: Vec<i64> = {
        let mut stmt = conn
            .prepare(
                "SELECT e.id FROM points e WHERE e.is_cited <> EXISTS(
                   SELECT 1 FROM lines x WHERE x.to_id = e.id
                     AND (x.name_id IS NULL OR x.name_id <> 0))
                 ORDER BY e.id",
            )
            .unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    assert!(drift.is_empty(), "is_cited 与入非子级线不一致的点: {drift:?}");
}

/// ② 无孤儿标签(无引用线、无子节点);失败信息列出全部孤儿路径。
pub(crate) fn assert_no_orphan_tags(conn: &Connection) {
    let mut stmt = conn
        .prepare(
            "SELECT t.path FROM points t WHERE t.path IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM lines l
                               WHERE (l.name_id IS NULL OR l.name_id <> 0)
                                 AND (l.from_id = t.id OR l.to_id = t.id))
              AND NOT EXISTS (SELECT 1 FROM points c WHERE c.path IS NOT NULL AND c.parent_id = t.id)
              ORDER BY t.path",
        )
        .unwrap();
    let found: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(found.is_empty(), "存在孤儿标签(无链接且无子节点): {found:?}");
}

/// ④ 无悬空关系行:'tag'/'type' 两种 target_type 的 to_id 都指向存在的标签(R5 的
/// delete_subtree/merge 清行不彻底时报警)。
pub(crate) fn assert_no_dangling_carries(conn: &Connection) {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM lines l JOIN points s ON s.id = l.from_id
              WHERE (l.name_id IS NULL OR l.name_id <> 0) AND s.path IS NOT NULL
                AND l.to_id NOT IN (SELECT id FROM points WHERE path IS NOT NULL)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 0, "存在悬空关系行(target_type='tag'/'type' 的 to_id 指向已不存在的标签)");
}

/// ⑤ 携带图无环(S3):任取一条携带线 a→b,若 b 沿携带方向能走回 a 即成环(2 环及以上都能查)。
pub(crate) fn assert_carry_acyclic(conn: &Connection) {
    let mut stmt = conn
        .prepare(
            "SELECT l.from_id, l.to_id FROM lines l JOIN points s ON s.id = l.from_id
              WHERE (l.name_id IS NULL OR l.name_id <> 0) AND s.path IS NOT NULL",
        )
        .unwrap();
    let edges: Vec<(i64, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    let cycles: Vec<String> = edges
        .into_iter()
        .filter(|&(a, b)| super::relation::reaches(conn, b, a).unwrap_or(false))
        .map(|(a, b)| format!("{a}->{b}"))
        .collect();
    assert!(cycles.is_empty(), "携带图存在环(S3 禁止): {cycles:?}");
}

/// ③ filter_current 引用的路径必须存在;键缺失/坏 JSON/坏条件一律跳过(与 filter_rewrite 同口径)。
pub(crate) fn assert_filter_paths_exist(conn: &Connection) {
    let Some(raw) = settings::get(conn, FILTER_CURRENT_KEY).unwrap() else {
        return;
    };
    let Ok(conds) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let mut refs: Vec<String> = Vec::new();
    for key in ["tags", "excludeTags"] {
        for t in conds[key].as_array().into_iter().flatten() {
            if let Some(p) = t["path"].as_str() {
                refs.push(p.to_string());
            }
        }
    }
    if let Some(expr) = conds["expr"].as_str() {
        if let Ok(spans) = lex_spans(expr) {
            for (token, _, _) in spans {
                if let Token::Tag { path, .. } = token {
                    refs.push(path);
                }
            }
        }
    }
    let missing: Vec<&String> = refs
        .iter()
        .filter(|p| {
            conn.query_row("SELECT COUNT(*) FROM points WHERE path IS NOT NULL AND path = ?1", params![p], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap()
                == 0
        })
        .collect();
    assert!(missing.is_empty(), "filter_current 引用了不存在的标签路径: {missing:?}");
}

#[cfg(test)]
#[path = "invariants_cases_tests.rs"]
mod cases;

/// T3.5 副本串跑探针(默认忽略,需 `LIFELOG_COPY_DB`)。
#[cfg(test)]
#[path = "invariants_probe_tests.rs"]
mod invariants_probe_tests;
