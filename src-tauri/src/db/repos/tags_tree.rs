//! 标签树仓库层(MVP-2 Task 3):建路径、链接、孤儿回收;结构变更见 ops,查询见 query。
//! 树真源是 parent_id,path 为冗余但受唯一索引约束,结构变更必须同步维护 path/depth;
//! 路径前缀比较一律用 substr 而非 LIKE(存量标签名可能含 % 或 _),ensure_path/link_note 收在调用方事务里。
//! 空标签回收策略:既无 tag_links 又无子节点的容器才回收(link_paths 与 delete_subtree 一致)。
use rusqlite::{params, Connection, OptionalExtension};

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

/// 结构变更(改名/移动/删除树)不经过 tag_links 触发器,需按当前链接聚合显式重写 FTS 行
pub(crate) fn refresh_fts(conn: &Connection, note_ids: &[i64]) -> rusqlite::Result<()> {
    for id in note_ids {
        conn.execute("DELETE FROM notes_fts WHERE rowid = ?1", params![id])?;
        conn.execute(
            "INSERT INTO notes_fts(rowid, content, tags)
             SELECT n.id, n.content, COALESCE((SELECT group_concat(t.path, ' ')
               FROM tags t JOIN tag_links l ON l.tag_id = t.id
               WHERE l.target_type = 'note' AND l.target_id = n.id), '')
             FROM notes n WHERE n.id = ?1",
            params![id],
        )?;
    }
    Ok(())
}

/// 按路径段建标签:父级不存在则同级创建,返回末端 id(不自行开事务,收在调用方事务里)。
/// C-2 和解:path 唯一,若占位行的 name/parent/depth 与目标身份不符(006 原样保留的
/// 名称含 '/' 的平铺标签即属此类),就地规整进树:复用其 id 与链接、改写身份,
/// 子树深度按差值顺延 —— 既不静默复用错行,也不报错、不丢链接。
pub fn ensure_path(conn: &Connection, segments: &[String]) -> rusqlite::Result<i64> {
    if segments.is_empty() {
        return Err(rusqlite::Error::InvalidParameterName("空标签路径".into()));
    }
    let mut parent: Option<i64> = None;
    let mut prefix = String::new();
    let mut leaf = 0i64;
    for (i, seg) in segments.iter().enumerate() {
        if i > 0 {
            prefix.push('/');
        }
        prefix.push_str(seg);
        let depth = (i + 1) as i64;
        let found: Option<(i64, String, Option<i64>, i64)> = conn
            .query_row(
                "SELECT id, name, parent_id, depth FROM tags WHERE path = ?1",
                params![prefix],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        leaf = match found {
            Some((id, name, pid, d)) if name == *seg && pid == parent && d == depth => id,
            Some((id, _, _, d)) => {
                reconcile(conn, id, seg, parent, depth, d)?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO tags(name, parent_id, path, depth) VALUES(?1, ?2, ?3, ?4)",
                    params![seg, parent, prefix, depth],
                )?;
                conn.last_insert_rowid()
            }
        };
        parent = Some(leaf);
    }
    Ok(leaf)
}

/// 把占位行就地改写成目标身份(id / path / 链接不变),其子树深度按差值顺延。
/// path 唯一索引保证同一 path 只有一行,故"path 命中但身份不符"的行只可能是迁移保留的
/// 平铺根(它没有同级兄弟可冲突),就地改写是安全的。
fn reconcile(
    conn: &Connection,
    id: i64,
    name: &str,
    parent: Option<i64>,
    depth: i64,
    old_depth: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tags SET name = ?1, parent_id = ?2, depth = ?3 WHERE id = ?4",
        params![name, parent, depth, id],
    )?;
    if depth != old_depth {
        conn.execute(
            "WITH RECURSIVE sub(id) AS (
               SELECT id FROM tags WHERE parent_id = ?1
               UNION ALL SELECT t.id FROM tags t JOIN sub s ON t.parent_id = s.id
             ) UPDATE tags SET depth = depth + ?2 WHERE id IN (SELECT id FROM sub)",
            params![id, depth - old_depth],
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
pub(crate) fn link_paths(conn: &Connection, note_id: i64, paths: &[String]) -> rusqlite::Result<()> {
    let mut desired: Vec<i64> = Vec::new();
    for path in paths {
        let segs = crate::tags::parse_tag_path(path).ok_or_else(|| {
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
#[path = "tags_tree_ops.rs"]
mod ops;
#[path = "tags_tree_path.rs"]
mod path;
#[path = "tags_tree_query.rs"]
mod query;
#[path = "tags_tree_replace.rs"]
mod replace;
pub use ops::{delete_subtree, move_to, rename};
pub(crate) use replace::{replace_links, resolve_id};
pub use query::{complete, counts, impact, TagCount};

#[cfg(test)]
#[path = "tags_tree_tests.rs"]
mod tags_tree_tests;

#[cfg(test)]
#[path = "tags_tree_ops_tests.rs"]
mod tags_tree_ops_tests;

#[cfg(test)]
#[path = "tags_tree_ops_extra_tests.rs"]
mod tags_tree_ops_extra_tests;

#[cfg(test)]
#[path = "tags_tree_replace_tests.rs"]
mod tags_tree_replace_tests;

#[cfg(test)]
#[path = "tags_tree_legacy_tests.rs"]
mod tags_tree_legacy_tests;
