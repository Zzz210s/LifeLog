//! 线的**唯一写入入口**(架构精简 B,2026-10-27)。
//!
//! 之前 13 个 `INSERT INTO lines` 分散在 12 个文件里,每处自己决定:
//! 用不用 `OR IGNORE`、冲突怎么办、插完要不要 `sync_is_cited`、名字点用 `NULL` 还是 `0`。
//! 这三件事(去重策略 / 冲突语义 / 派生列刷新)历史上各出过一次 bug
//! (名线删不掉、0 行删除当成功、`is_cited` 与入边不一致),所以收到这里。
//!
//! 约定:
//! - 读走视图(`line_kind`:tag/tree/relation/non_tree),写走本模块;
//! - **视图不可写** —— 删除必须落到基表 `lines`,用 `id IN (SELECT id FROM <view>)` 表达;
//! - 每次增删后**重算目标的 `is_cited`**(有非子级入边即被引用),由本模块统一做。
use crate::db::repos::entities::closure::sync_is_cited;
use rusqlite::{params, Connection};

/// 建线;**已存在则静默跳过**(同一对点 + 同一名字点的线由 `idx_lines_uniq` 去重)。
/// 返回是否真的插入了(`false` = 幂等命中)。
pub(crate) fn insert(
    conn: &Connection,
    from: i64,
    to: i64,
    name_id: Option<i64>,
) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "INSERT OR IGNORE INTO lines(from_id, to_id, name_id) VALUES(?1, ?2, ?3)",
        params![from, to, name_id],
    )?;
    if n > 0 {
        sync_is_cited(conn, to)?;
    }
    Ok(n > 0)
}

/// 建线;**重复即报错**(给用户的显式操作要看得见冲突,例如"添加关系")。
/// 冲突时返回中文原因,非冲突错误原样上抛为 `InvalidParameterName`。
pub(crate) fn insert_strict(
    conn: &Connection,
    from: i64,
    to: i64,
    name_id: Option<i64>,
    conflict_msg: &str,
) -> rusqlite::Result<()> {
    match conn.execute(
        "INSERT INTO lines(from_id, to_id, name_id) VALUES(?1, ?2, ?3)",
        params![from, to, name_id],
    ) {
        Ok(_) => {
            sync_is_cited(conn, to)?;
            Ok(())
        }
        Err(e) if e.to_string().contains("UNIQUE constraint failed") => {
            Err(rusqlite::Error::InvalidParameterName(conflict_msg.to_string()))
        }
        Err(e) => Err(e),
    }
}

/// 子级线(树):`name_id = 0` 保留名字点「子级」
pub(crate) fn insert_tree(conn: &Connection, parent: i64, child: i64) -> rusqlite::Result<bool> {
    insert(conn, parent, child, Some(crate::db::repos::entities::reserved::TREE_NAME_ID))
}

/// 无名线(打标签 / `[[ ]]` 链接)
pub(crate) fn insert_tag(conn: &Connection, from: i64, to: i64) -> rusqlite::Result<bool> {
    insert(conn, from, to, None)
}

/// 按线 id 删除(用户的"移除"动作)。返回删除行数;删掉后重算目标 `is_cited`。
pub(crate) fn delete_by_id(conn: &Connection, line_id: i64) -> rusqlite::Result<usize> {
    let to: Option<i64> = conn
        .query_row("SELECT to_id FROM lines WHERE id = ?1", [line_id], |r| r.get(0))
        .ok();
    let n = conn.execute("DELETE FROM lines WHERE id = ?1", [line_id])?;
    if let Some(t) = to {
        sync_is_cited(conn, t)?;
    }
    Ok(n)
}

/// 删除"某来源指向某目标的无名线"(打标签的反向操作)。
/// **名线(关系)一律不动** —— 它们表达的是声明,不是标签。
pub(crate) fn delete_tag_line(conn: &Connection, from: i64, to: i64) -> rusqlite::Result<usize> {
    let n = conn.execute(
        "DELETE FROM lines WHERE id IN (SELECT id FROM tag_lines WHERE from_id = ?1 AND to_id = ?2)",
        params![from, to],
    )?;
    if n > 0 {
        sync_is_cited(conn, to)?;
    }
    Ok(n)
}

/// 删除**与某点相邻**(出边或入边)的全部无名/名线 —— 合并标签时清掉源点的关系线。
/// 子级线不在此列(树结构由 `delete_tree_lines_to` 单独处理)。
pub(crate) fn delete_non_tree_touching(conn: &Connection, point: i64) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM lines WHERE id IN (
           SELECT id FROM non_tree_lines WHERE from_id = ?1 OR to_id = ?1)",
        [point],
    )
}

/// 删除指向某点的全部子级线(删/并标签时把该点从树里摘掉)
pub(crate) fn delete_tree_lines_to(conn: &Connection, point: i64) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM lines WHERE id IN (SELECT id FROM tree_lines WHERE to_id = ?1)",
        [point],
    )
}

#[cfg(test)]
#[path = "lines_write_tests.rs"]
mod lines_write_tests;
