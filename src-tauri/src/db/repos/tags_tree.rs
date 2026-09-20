//! 标签树仓库层(MVP-2 Task 3):建路径、链接、孤儿回收;结构变更见 ops,查询见 query。
//! 树真源是 parent_id,path 为冗余但受唯一索引约束,结构变更必须同步维护 path/depth;
//! 路径前缀比较一律用 substr 而非 LIKE(存量标签名可能含 % 或 _),ensure_path/link_note 收在调用方事务里。
//! 空标签回收策略:既无 tag_links 又无子节点的容器才回收(link_paths 与 delete_subtree 一致)。
use super::tag_alias;
use rusqlite::{params, Connection};

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
/// 聚合口径必须与迁移 011 重建的触发器一致:收**全部**标签的完整路径
/// (时间标签已是普通标签,与其它标签同权,见 D3)。
pub(crate) fn refresh_fts(conn: &Connection, note_ids: &[i64]) -> rusqlite::Result<()> {
    for id in note_ids {
        conn.execute("DELETE FROM notes_fts WHERE rowid = ?1", params![id])?;
        conn.execute(
            "INSERT INTO notes_fts(rowid, content, tags)
             SELECT n.id, n.content, COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
               FROM tags t JOIN tag_links l ON l.tag_id = t.id
               WHERE l.target_type = 'note' AND l.target_id = n.id), '')
             FROM notes n WHERE n.id = ?1",
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

/// 笔记维度的链接替换(增量):只删不再需要的、只补缺失的,未变化的链接保持原样
/// (节点 id 与触发器行为稳定)。路径经 parse_tag_path 校验后走 ensure_path 自动建父级。
/// 按路径精确取标签 id(不存在返回 None);用于"真实标签优先于别名"的判定。
/// **只认结构自洽的节点**:path 里含 `/` 时必须有父节点 —— 006 之前的存量平铺标签
/// 可能是"name=path=a/b 但 parent_id 为空"的幻影层级(见 tags_tree_path::child_path 的说明),
/// 那种节点不该抢走 `#a/b` 的解析,否则永远修不成两层结构。
fn existing_id(conn: &Connection, path: &str) -> rusqlite::Result<Option<i64>> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "SELECT id FROM tags WHERE path = ?1 AND (parent_id IS NOT NULL OR instr(path, '/') = 0)",
        params![path],
        |r| r.get(0),
    )
    .optional()
}
/// 解析顺序(spec D2/D3,保存漏斗唯一解析点):**真实标签优先,其次别名,最后新建**。
/// ① 该路径已是存在的标签 -> 用它(用户确实能创建/保留同名标签,别名不该把它挡住)
/// ② 否则查别名表,命中即改用目标标签的**当前路径**(目标必然已存在,ensure_path 幂等命中它)
/// ③ 都没有 -> 原样解析并自动建树。
pub(crate) fn link_paths(conn: &Connection, note_id: i64, paths: &[String]) -> rusqlite::Result<()> {
    let mut desired: Vec<i64> = Vec::new();
    for path in paths {
        if let Some(id) = existing_id(conn, path.trim())? {
            if !desired.contains(&id) {
                desired.push(id);
            }
            continue;
        }
        let canonical = tag_alias::resolve(conn, path)?;
        let target = canonical.as_deref().unwrap_or(path.as_str());
        let segs = crate::tags::parse_tag_path(target).ok_or_else(|| {
            rusqlite::Error::InvalidParameterName(format!("非法标签路径: {path}"))
        })?;
        let id = ensure_path(conn, &segs)?;
        if !desired.contains(&id) {
            desired.push(id);
        }
    }
    replace::replace_links(conn, note_id, &desired)
}

/// 精确回收孤儿标签:既无 tag_links 又无子节点(父节点天生没有链接,不得当孤儿删)。
/// 循环删除以覆盖"整条链都成孤儿"的情形(深度上限 5,循环次数有界)。
pub(crate) fn gc_orphans(conn: &Connection) -> rusqlite::Result<()> {
    loop {
        let n = conn.execute(
            "DELETE FROM tags
             WHERE NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.tag_id = tags.id)
               AND NOT EXISTS (SELECT 1 FROM tags c WHERE c.parent_id = tags.id)",
            [],
        )?;
        if n == 0 {
            return Ok(());
        }
    }
}

// Task 4 命令层已接入:结构化/查询接口均有生产调用方,不再需要 allow(dead_code)
#[path = "tags_tree_ensure.rs"]
mod ensure;
#[path = "tags_tree_ops.rs"]
mod ops;
#[path = "tags_tree_ops_sql.rs"]
mod ops_sql;
#[path = "tags_tree_path.rs"]
mod path;
#[path = "tags_tree_query.rs"]
mod query;
#[path = "tags_tree_replace.rs"]
mod replace;
pub use ensure::ensure_path;
pub use ops::{delete_subtree, move_beside, move_to, rename};
// `complete`(纯标签路径补全)现在只被 complete_with_aliases 与仓库层测试使用,不再向命令层导出;
// 测试用的导出放进 cfg(test),避免非测试构建报 unused_imports
#[cfg(test)]
pub use query::complete;
pub use query::{complete_with_aliases, counts, impact, CompleteItem, TagCount};

#[cfg(test)]
#[path = "tags_tree_alias_tests.rs"]
mod tags_tree_alias_tests;

#[cfg(test)]
#[path = "tags_tree_tests.rs"]
mod tags_tree_tests;

#[cfg(test)]
#[path = "tags_tree_id_tests.rs"]
mod tags_tree_id_tests;

#[cfg(test)]
#[path = "tags_tree_ops_tests.rs"]
mod tags_tree_ops_tests;

#[cfg(test)]
#[path = "tags_tree_order_support.rs"]
mod order_support;

#[cfg(test)]
#[path = "tags_tree_order_tests.rs"]
mod tags_tree_order_tests;

#[cfg(test)]
#[path = "tags_tree_order_sql_tests.rs"]
mod tags_tree_order_sql_tests;

#[cfg(test)]
#[path = "tags_tree_ops_extra_tests.rs"]
mod tags_tree_ops_extra_tests;

#[cfg(test)]
#[path = "tags_tree_time_ops_tests.rs"]
mod tags_tree_time_ops_tests;

#[cfg(test)]
#[path = "tags_tree_replace_tests.rs"]
mod tags_tree_replace_tests;

#[cfg(test)]
#[path = "tags_tree_legacy_tests.rs"]
mod tags_tree_legacy_tests;

#[cfg(test)]
#[path = "tags_tree_complete_alias_tests.rs"]
mod tags_tree_complete_alias_tests;
