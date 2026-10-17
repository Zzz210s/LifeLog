//! 批量加 / 去标签的仓库层(spec 2026-10-17 §4.1 / §4.2):只碰**无名字线**,单事务,幂等。
//!
//! - 加标签:目标必须是**存在的树内标签**(`tag_exists` 要求 `path IS NOT NULL`)—— 不隐式建点;
//!   已有同名无名字线的条目计入 `existed` 跳过;自指与脏 id 也跳过。
//! - 去标签:只删 `name_id IS NULL` 的线;指向同目标的名线(关系)一律不动,只计数回报。
//!   刻意**不跑 `gc_orphans`**:去标签 ≠ 删标签,目标即使零引用也保留。
use crate::db::repos::tags::tag_exists;
use rusqlite::{params, Connection};

/// 批量加标签读数:`added` = 本次新建的无名字线数,`existed` = 已有 / 自指等跳过数。
#[derive(Debug, PartialEq, Eq)]
pub struct TagAdded {
    pub added: i64,
    pub existed: i64,
}

/// 批量去标签读数:`removed` = 删掉的无名字线数,`kept_named` = 同目标上原样保留的名线数。
#[derive(Debug, PartialEq, Eq)]
pub struct TagRemoved {
    pub removed: i64,
    pub kept_named: i64,
}

/// 点(条目或标签)是否存在;脏 id 一律跳过,不让外键错误把整批打回。
fn point_exists(conn: &Connection, id: i64) -> rusqlite::Result<bool> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM points WHERE id = ?1)", params![id], |r| r.get(0))
}

/// 批量加标签(单事务幂等):返回新建 / 跳过读数。目标标签不存在 -> 中文错,一条不写。
pub fn add_tag(conn: &mut Connection, points: &[i64], target: i64) -> Result<TagAdded, String> {
    if !tag_exists(conn, target).map_err(|e| e.to_string())? {
        return Err(format!("标签不存在：{target}"));
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut added = 0i64;
    let mut existed = 0i64;
    for id in points {
        if *id == target || !point_exists(&tx, *id).map_err(|e| e.to_string())? {
            existed += 1;
            continue;
        }
        let has: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM lines
                 WHERE from_id = ?1 AND to_id = ?2 AND name_id IS NULL)",
                params![id, target],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if has {
            existed += 1;
            continue;
        }
        added += tx
            .execute(
                "INSERT INTO lines(from_id, to_id, name_id) VALUES(?1, ?2, NULL)",
                params![id, target],
            )
            .map_err(|e| e.to_string())? as i64;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(TagAdded { added, existed })
}

/// 批量去标签(单事务):只删无名字线,名线原样保留并计数。目标不存在时 0/0,不报错。
pub fn remove_tag(conn: &mut Connection, points: &[i64], target: i64) -> Result<TagRemoved, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut removed = 0i64;
    let mut kept_named = 0i64;
    for id in points {
        removed += tx
            .execute(
                "DELETE FROM lines WHERE from_id = ?1 AND to_id = ?2 AND name_id IS NULL",
                params![id, target],
            )
            .map_err(|e| e.to_string())? as i64;
        kept_named += tx
            .query_row(
                "SELECT COUNT(*) FROM lines
                 WHERE from_id = ?1 AND to_id = ?2 AND name_id IS NOT NULL",
                params![id, target],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(TagRemoved { removed, kept_named })
}

#[cfg(test)]
#[path = "batch_tag_tests.rs"]
mod batch_tag_tests;
