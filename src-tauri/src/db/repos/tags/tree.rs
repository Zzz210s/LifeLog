//! 标签树仓库层(MVP-2 Task 3):建路径、链接、孤儿回收;结构变更见 ops,查询见 query。
//! 树真源是 parent_id,path 为冗余但受唯一索引约束,结构变更必须同步维护 path/depth;
//! 路径前缀比较一律用 substr 而非 LIKE(存量标签名可能含 % 或 _),ensure_path/link_note 收在调用方事务里。
//! 空标签回收策略:既无 tag_links、无指向它的携带行、又无子节点的容器才回收(link_paths 与 delete_subtree 一致)。
//! 路径 -> id 的解析漏斗与链接替换已拆到 link.rs(replace::replace_links),本文件只留树本身。
use rusqlite::{params, Connection};

use super::fts_tags::TAGS_AGG;

/// 前缀补全返回上限:前缀过短时不一次吐全库
const COMPLETE_LIMIT: i64 = 50;

/// 标签(含自身)的子树 id,按深度降序 —— 先子后父,便于删除与统计
pub fn subtree_ids(conn: &Connection, tag_id: i64) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE sub(id, depth) AS (
           SELECT id, depth FROM tags WHERE id = ?1
           UNION ALL
           SELECT t.id, t.depth FROM tags t JOIN sub s ON t.parent_id = s.id
         ) SELECT id FROM sub ORDER BY depth DESC, id",
    )?;
    let rows = stmt.query_map(params![tag_id], |r| r.get(0))?;
    rows.collect()
}

/// 子树内被链接到的笔记 id(结构变更后重写 FTS 行的输入)
pub(crate) fn linked_notes(conn: &Connection, tag_ids: &[i64]) -> rusqlite::Result<Vec<i64>> {
    if tag_ids.is_empty() {
        return Ok(Vec::new());
    }
    let marks = vec!["?"; tag_ids.len()].join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT DISTINCT target_id FROM tag_links
         WHERE target_type = 'note' AND tag_id IN ({marks}) ORDER BY target_id"
    ))?;
    let rows = stmt.query_map(rusqlite::params_from_iter(tag_ids.iter()), |r| r.get(0))?;
    rows.collect()
}

/// 结构变更(改名/移动/删除树)不经过 tag_links 触发器,需按当前链接聚合显式重写 FTS 行。
/// 聚合口径的唯一真源是 [`super::fts_tags::TAGS_AGG`](路径 + 纯文本路径 + 别名;时间标签已是普通标签,
/// 与其它标签同权,见 D3),与迁移 018 重建的触发器、维护命令的 rebuild 逐字一致。
pub(crate) fn refresh_fts(conn: &Connection, note_ids: &[i64]) -> rusqlite::Result<()> {
    for id in note_ids {
        conn.execute("DELETE FROM notes_fts WHERE rowid = ?1", params![id])?;
        conn.execute(
            &format!(
                "INSERT INTO notes_fts(rowid, content, tags)
                 SELECT n.id, n.content, {TAGS_AGG} FROM notes n WHERE n.id = ?1"
            ),
            params![id],
        )?;
    }
    Ok(())
}


/// 链接笔记到标签(幂等)。tag_links 触发器负责把聚合路径同步进 FTS。
pub fn link_note(conn: &Connection, note_id: i64, tag_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'note', ?2)",
        params![tag_id, note_id],
    )?;
    Ok(())
}

/// 精确回收孤儿标签:既无 tag_links(任何方向)、又无子节点、又不是任何 'tag'/'type' 行的目标
/// (父节点天生没有链接,不得当孤儿删)。被指向的标签(如只做关系声明的 `地点轴/国籍`)、
/// 认领了关系的值标签(`中国`)都是有用处的空壳:回收它们会让关系静默消失,
/// 故必须与"有笔记链接"同等对待,不得回收(R7)。'type' 行已由迁移 022 并入 'tag',
/// 这里保留 `IN ('tag','type')` 只为兜住历史重放中的极端情形。
/// 循环删除以覆盖"整条链都成孤儿"的情形(链有多长就循环多少次)。
pub(crate) fn gc_orphans(conn: &Connection) -> rusqlite::Result<()> {
    loop {
        let n = conn.execute(
            "DELETE FROM tags
             WHERE NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.tag_id = tags.id)
               AND NOT EXISTS (SELECT 1 FROM tag_links c WHERE c.target_type IN ('tag', 'type') AND c.target_id = tags.id)
               AND NOT EXISTS (SELECT 1 FROM tags ch WHERE ch.parent_id = tags.id)",
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
pub use ops::{delete_subtree, move_beside, move_to, rename};
// 路径 -> id 的解析漏斗:解析顺序与别名优先级的唯一实现(见 link.rs)
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
