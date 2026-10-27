//! 来源的**当前线表**(2026-10-12 任务 A 自 note_links.rs 拆出守 200 行上限;
//! T3 起从「只读有名线」升级为「读全部非子级线 + 可选名字」,名字不再被折叠掉)。
//! 判据只此一处:`name_id IS NULL OR name_id <> 0` —— `name_id = 0` 是树的结构线(子级),
//! 不算来源的引用(设计 §6.3;`read_full` 的 `TAG_JOINS` 同口径)。
use rusqlite::{params, Connection};

/// 来源全部**非子级线**的原始行 `(线 id, 目标 id, 名字点 id)`,按线 id。
/// 写路径要线 id 才能「换名字 = UPDATE 同一条线」(线身份稳定、触发器口径不变),故这一层不折叠名字。
pub(super) fn rows(
    conn: &Connection,
    source_id: i64,
) -> rusqlite::Result<Vec<(i64, i64, Option<i64>)>> {
    let mut stmt = conn.prepare(
        "SELECT id, to_id, name_id FROM lines
          WHERE from_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map(params![source_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    rows.collect()
}

/// 来源的当前线表 `(目标 id, 名字点 id)`(无名字线为 None)—— §0.2 冻结的读形,投影自上面的 [`rows`]。
/// 生产写路径要线 id 才能「换名字 = UPDATE 同一条线」,故走 [`rows`];这一层给回归用例读
/// (§6.2 映射表断言的就是这个形状),`#[cfg(test)]` 以免生产构建里成为未用符号。
/// 同一目标可能有多条线(面板可造,§6.2 第 13 行),这里如实返回、不去重。
#[cfg(test)]
pub(crate) fn current_lines(
    conn: &Connection,
    source_id: i64,
) -> rusqlite::Result<Vec<(i64, Option<i64>)>> {
    Ok(rows(conn, source_id)?.into_iter().map(|(_, to, name)| (to, name)).collect())
}

/// 任务 A 回归:有名线也按目标集合替换(自 note_links_named.rs 挂载)。
#[cfg(test)]
#[path = "note_links_named_tests.rs"]
mod note_links_named_tests;
