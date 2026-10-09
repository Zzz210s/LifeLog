//! 标签树仓库层(MVP-2 Task 3):建路径、链接、孤儿回收;结构变更见 ops,查询见 query。
//! T4.1 起树真源是 `edges(kind='child')`,`entities.parent_id/path/depth` 是派生缓存
//! (写路径同事务维护,见 ensure/ops/merge);路径前缀比较一律用 substr 而非 LIKE
//! (存量标签名可能含 % 或 _),ensure_path/link_note 收在调用方事务里。
//! 空标签回收策略:既无出边、又无 `child` 以外的入边才回收(link_paths 与 delete_subtree 一致)。
//! 路径 -> id 的解析漏斗与链接替换已拆到 link.rs(replace::replace_links),本文件只留树本身。
use rusqlite::{params, Connection};

use crate::db::repos::entities::fts::ENTITIES_AGG;

/// 前缀补全返回上限:前缀过短时不一次吐全库
const COMPLETE_LIMIT: i64 = 50;

/// 子树 id(含自身),按深度降序 —— 先子后父,便于删除与统计。
/// v28 起树内实体由 `path` 表达、`child` 边承载父子,不再有 `kind` 列(spec §2.5 / §10-P3)。
pub fn subtree_ids(conn: &Connection, tag_id: i64) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE sub(id, depth) AS (
           SELECT id, depth FROM entities WHERE id = ?1
           UNION ALL
           SELECT t.id, t.depth FROM entities t JOIN sub s ON t.parent_id = s.id
         ) SELECT id FROM sub ORDER BY depth DESC, id",
    )?;
    let rows = stmt.query_map(params![tag_id], |r| r.get(0))?;
    rows.collect()
}

/// 子树内被链接到的引用源 id(结构变更后重写 FTS 行的输入):
/// `link` 边的 `source_id`(spec §2.4,老 `tagging`/`relation`/`link` 三种迁后都是 `link`)。
pub(crate) fn linked_notes(conn: &Connection, tag_ids: &[i64]) -> rusqlite::Result<Vec<i64>> {
    if tag_ids.is_empty() {
        return Ok(Vec::new());
    }
    let marks = vec!["?"; tag_ids.len()].join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT DISTINCT source_id FROM edges
         WHERE kind = 'link' AND target_id IN ({marks}) ORDER BY source_id"
    ))?;
    let rows = stmt.query_map(rusqlite::params_from_iter(tag_ids.iter()), |r| r.get(0))?;
    rows.collect()
}

/// `entities_fts` 的显式重写:结构变更(改名/移动/删除/合并)后按受影响实体 id 重写。
/// 聚合口径真源 = [`ENTITIES_AGG`](每实体统一求值:自身段 + 出 `link` 边目标段,spec §6.2)。
pub(crate) fn refresh_entities_fts(conn: &Connection, entity_ids: &[i64]) -> rusqlite::Result<()> {
    for id in entity_ids {
        conn.execute("DELETE FROM entities_fts WHERE rowid = ?1", params![id])?;
        conn.execute(
            &format!(
                "INSERT INTO entities_fts(rowid, meta, paths)
                 SELECT e.id, e.meta, {ENTITIES_AGG} FROM entities e WHERE e.id = ?1"
            ),
            params![id],
        )?;
    }
    Ok(())
}

/// 链接笔记到标签(幂等)。方向 = 引用方 -> 被引用方(spec §2.3),同向同类边由唯一约束去重。
/// 生产保存路径改走 `note_links::replace_ids`,此处仅剩 `tags::replace::replace_links`(测试专用)在用。
#[cfg(test)]
pub fn link_note(conn: &Connection, note_id: i64, tag_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO edges(source_id, target_id, kind, remark, created_at)
         VALUES(?1, ?2, 'link', '', datetime('now', 'localtime'))",
        params![note_id, tag_id],
    )?;
    crate::db::repos::entities::closure::sync_is_cited(conn, tag_id)
}

/// 精确回收孤儿:既无出边、又无 `link` 入边才回收(循环删除,链有多长就循环多少次)。
/// `child` 入边是结构边,不算引用(spec §3.1 / §3.2):有父不是「有用」,
/// 这样 `时间/2026/10/08` 的引用者全删后整条死链能逐层回收。
/// `path IS NOT NULL` 是 ≤ v27 `kind='tag'` 的等价选择器(spec §2.5),保证只碰树内空壳,
/// 不误删树外笔记实体。
pub(crate) fn gc_orphans(conn: &Connection) -> rusqlite::Result<()> {
    loop {
        let n = conn.execute(
            "DELETE FROM entities
             WHERE path IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM edges x WHERE x.source_id = entities.id)
               AND NOT EXISTS (
                 SELECT 1 FROM edges y
                 WHERE y.target_id = entities.id AND y.kind = 'link')",
            [],
        )?;
        if n == 0 {
            return Ok(());
        }
    }
}

// Task 4 命令层已接入:结构化/查询接口均有生产调用方,不再需要 allow(dead_code)
#[path = "ensure.rs"]
mod ensure;
#[path = "link.rs"]
mod link;
#[path = "ops.rs"]
mod ops;
#[path = "ops_delete.rs"]
mod ops_delete;
#[path = "ops_sql.rs"]
mod ops_sql;
#[path = "path.rs"]
mod path;
#[path = "query.rs"]
mod query;
#[path = "replace.rs"]
mod replace;
#[path = "similar.rs"]
mod similar;
pub use ensure::ensure_path;
pub use ops::{move_beside, move_to, rename};
pub use ops_delete::delete_subtree;
// 路径 -> id 的解析漏斗:解析顺序与别名优先级的唯一实现(见 link.rs)
pub(crate) use link::resolve_paths;
// `link_paths`(解析 + 替换)自 T2.1 起生产路径已不再调用 —— 笔记保存改走
// notes::write_saved_links(resolve_paths + [[ ]] 求并集);仅测试沿用旧入口。
#[cfg(test)]
pub(crate) use link::link_paths;
// `complete`(纯标签路径补全)现在只被 complete_with_aliases 与仓库层测试使用,不再向命令层导出;
// 测试用的导出放进 cfg(test),避免非测试构建报 unused_imports
#[cfg(test)]
pub use query::complete;
pub use query::{complete_with_aliases, counts, impact, CompleteItem, TagCount};

#[cfg(test)]
#[path = "tree_alias_tests.rs"]
mod tree_alias_tests;

#[cfg(test)]
#[path = "tree_tests.rs"]
mod tree_tests;

#[cfg(test)]
#[path = "tree_id_tests.rs"]
mod tree_id_tests;

#[cfg(test)]
#[path = "tree_ops_tests.rs"]
mod tree_ops_tests;

#[cfg(test)]
#[path = "order_support.rs"]
mod order_support;

#[cfg(test)]
#[path = "tree_order_tests.rs"]
mod tree_order_tests;

#[cfg(test)]
#[path = "tree_order_sql_tests.rs"]
mod tree_order_sql_tests;

#[cfg(test)]
#[path = "tree_ops_extra_tests.rs"]
mod tree_ops_extra_tests;

#[cfg(test)]
#[path = "tree_time_ops_tests.rs"]
mod tree_time_ops_tests;

#[cfg(test)]
#[path = "tree_replace_tests.rs"]
mod tree_replace_tests;

#[cfg(test)]
#[path = "tree_legacy_tests.rs"]
mod tree_legacy_tests;

#[cfg(test)]
#[path = "tree_complete_alias_tests.rs"]
mod tree_complete_alias_tests;

#[cfg(test)]
#[path = "tree_complete_similar_tests.rs"]
mod tree_complete_similar_tests;

#[cfg(test)]
#[path = "tree_similar_tests.rs"]
mod tree_similar_tests;

#[cfg(test)]
#[path = "tree_carry_tests.rs"]
mod tree_carry_tests;

#[cfg(test)]
#[path = "tree_gc_tests.rs"]
mod tree_gc_tests;
