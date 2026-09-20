//! 标签路径建树(自 tags_tree.rs 拆出以守 200 行上限):
//! 按路径段逐级复用/创建节点,并把"path 命中但身份不符"的存量占位行就地规整进树。
//! 不自行开事务,收在调用方事务里(link_paths / 创建笔记 / 迁移同事务)。
use rusqlite::{params, Connection, OptionalExtension};

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
