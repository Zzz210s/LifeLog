//! 标签写入不变量测试台(spec 2026-09-21 D:标签写入路径收敛)。五组判据复用:
//! ① [`assert_fts_matches_edges`]:entities_fts.paths == 按 edges 重算(唯一真源
//!    [`crate::db::repos::entities::fts::ENTITIES_AGG`],标签实体自身也进索引)。
//! ①b [`assert_is_cited_matches_edges`]:`entities.is_cited` == 有入 `link` 边(spec §3.1)。
//! ② [`assert_no_orphan_tags`]:无孤儿标签(无 tag_links 且无子节点)。
//! ③ [`assert_filter_paths_exist`]:filter_current 引用的每个标签路径都存在;只对"路径变化"类
//!    操作断言(删除按设计不改写条件 S7,留已删路径允许)。
//! ④ [`assert_no_dangling_carries`]:'tag' 行的 target_id 都指向存在的标签。
//! ⑤ [`assert_carry_acyclic`]:携带图无环(S3)。
use crate::db::repos::entities::fts::ENTITIES_AGG;
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY};
use crate::expr::lexer::{lex_spans, Token};
use rusqlite::{params, Connection, OptionalExtension};

/// ① 逐实体比对 entities_fts.paths;失败信息带实体 id 与两侧取值(左侧 FTS 实值、
/// 右侧按 edges 重算)。标签实体自身也有 paths,故不按 kind 过滤。
pub(crate) fn assert_fts_matches_edges(conn: &Connection) {
    let mut stmt = conn.prepare("SELECT id FROM entities ORDER BY id").unwrap();
    let ids: Vec<i64> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    for id in ids {
        let expected: String = conn
            .query_row(
                &format!("SELECT {ENTITIES_AGG} FROM entities e WHERE e.id = ?1"),
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        let actual: Option<String> = conn
            .query_row("SELECT paths FROM entities_fts WHERE rowid = ?1", params![id], |r| {
                r.get(0)
            })
            .optional()
            .unwrap();
        assert_eq!(
            actual.as_deref(),
            Some(expected.as_str()),
            "实体 {id} 的 entities_fts.paths 与 edges 聚合(自身段 + 引用段)不一致"
        );
    }
    let stale: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT rowid FROM entities_fts WHERE rowid NOT IN (SELECT id FROM entities) ORDER BY rowid")
            .unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    assert!(stale.is_empty(), "entities_fts 残留已不存在的实体行: {stale:?}");
}

/// ①b `is_cited` 与入 `link` 边一致(与对账 §3.7 第 1 条、T1.0 `reconcile.sql` 同口径):
/// 失败信息列出全部漂移实体 id(`child` 入边不算引用)。
pub(crate) fn assert_is_cited_matches_edges(conn: &Connection) {
    let drift: Vec<i64> = {
        let mut stmt = conn
            .prepare(
                "SELECT e.id FROM entities e WHERE e.is_cited <> EXISTS(
                   SELECT 1 FROM edges x WHERE x.target_id = e.id AND x.kind = 'link')
                 ORDER BY e.id",
            )
            .unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    assert!(drift.is_empty(), "is_cited 与入 link 边不一致的实体: {drift:?}");
}

/// ② 无孤儿标签(无 tag_id 链接、无指向它的关系边、无子节点);失败信息列出全部孤儿路径。
pub(crate) fn assert_no_orphan_tags(conn: &Connection) {
    let mut stmt = conn
        .prepare(
            "SELECT t.path FROM entities t WHERE t.path IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM edges e JOIN entities s ON s.id = e.source_id JOIN entities tt ON tt.id = e.target_id
                               WHERE e.kind = 'link' AND (s.path IS NOT NULL OR tt.path IS NOT NULL)
                                 AND (CASE WHEN s.path IS NOT NULL THEN e.source_id ELSE e.target_id END) = t.id)
              AND NOT EXISTS (SELECT 1 FROM edges e JOIN entities s ON s.id = e.source_id
                               WHERE e.kind = 'link' AND s.path IS NOT NULL AND e.target_id = t.id)
              AND NOT EXISTS (SELECT 1 FROM entities c WHERE c.path IS NOT NULL AND c.parent_id = t.id)
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

/// ④ 无悬空关系行:'tag'/'type' 两种 target_type 的 target_id 都指向存在的标签(R5 的
/// delete_subtree/merge 清行不彻底时报警;target_id 无外键,这是兜住它的唯一检查)。
pub(crate) fn assert_no_dangling_carries(conn: &Connection) {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM edges e JOIN entities s ON s.id = e.source_id
              WHERE e.kind = 'link' AND s.path IS NOT NULL
                AND e.target_id NOT IN (SELECT id FROM entities WHERE path IS NOT NULL)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 0, "存在悬空关系行(target_type='tag'/'type' 的 target_id 指向已不存在的标签)");
}

/// ⑤ 携带图无环(S3):任取一条携带边 a→b,若 b 沿携带方向能走回 a 即成环(2 环及以上都能查)。
pub(crate) fn assert_carry_acyclic(conn: &Connection) {
    let mut stmt = conn
        .prepare(
            "SELECT e.source_id, e.target_id FROM edges e JOIN entities s ON s.id = e.source_id
              WHERE e.kind = 'link' AND s.path IS NOT NULL",
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
            conn.query_row("SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path = ?1", params![p], |r| {
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
