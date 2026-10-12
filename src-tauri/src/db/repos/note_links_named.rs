//! 来源的**有名线(关系)**清单(2026-10-12 任务 A;自 note_links.rs 拆出守 200 行上限)。
//! 判据只此一处:`name_id IS NOT NULL AND name_id <> 0` —— `name_id = 0` 是树的结构线(子级),
//! 不算关系。写路径(`note_links::replace_ids` 的目标集合替换)与回归用例共用它。
use rusqlite::{params, Connection};

/// 来源的全部**有名**非子级线 `(目标 id, 名字点 id)`:编辑框回显的关系里带名字的那些。
///
/// 名字本身不在这里改(由「关系」面板维护)——调用方只用它判断「目标还在不在期望集合里」,
/// 决定这条名线是保留(名字不动)还是跟着删。
pub(crate) fn named_lines(conn: &Connection, source_id: i64) -> rusqlite::Result<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT to_id, name_id FROM lines
          WHERE from_id = ?1 AND name_id IS NOT NULL AND name_id <> 0",
    )?;
    let rows = stmt.query_map(params![source_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

/// 任务 A 回归:有名线也按目标集合替换(自 note_links_named.rs 挂载)。
#[cfg(test)]
#[path = "note_links_named_tests.rs"]
mod note_links_named_tests;
