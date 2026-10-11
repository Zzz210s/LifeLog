//! 名字点与线的细粒度读写(spec §3.2 / §6.4;计划 T3.2)。
//!
//! 名字点是普通点:关系名 = `meta` 为单段文本、`path`/`parent_id` 为 NULL、且只出现在
//! 线 `name_id` 位置的点(位置判据,不加判别列,spec §2.3 偏离二)。匹配一律**逐字节**
//! `meta`(`entity_key` 会把空白与 ASCII 大小写折叠,近名会被并成不可逆的信息损失,P10)。
//! 名字点不进树 / 图 / 搜索(§5.2),随线存在:线没了名字点由 GC 回收(T3.3)。
use rusqlite::{params, Connection, OptionalExtension};

use super::relation::reaches;
use crate::db::repos::entities::reserved::TREE_NAME_ID;

/// 按 `meta` 逐字节找**正在被线当名字用**的纯名字点,没有返回 None。
/// 判据与 spec §5.2 的 `is_pure_name` 同口径:出现在 `name_id` 位、不出现在任何线两端。
/// 不匹配「建了点但还没挂线」的孤儿:笔记同样 `path IS NULL`,不要求 `name_id` 角色会把
/// 一条恰好叫「国籍」的笔记误当名字点。
fn find_name_point(conn: &Connection, name: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT p.id FROM points p
          WHERE p.meta = ?1
            AND EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id)
            AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = p.id OR t.to_id = p.id)
          ORDER BY p.id LIMIT 1",
        params![name],
        |r| r.get(0),
    )
    .optional()
}

/// 解析关系名文本为名字点 id:已有同 `meta` 的纯名字点就复用,否则新建一个点。
/// 调用方负责把它指到线上(`set_tag_relation`)或在同一事务里建线;新建点先有 FTS 行,
/// 挂上名字线后由 `lines_ai` 触发器按位置判据抹掉。
pub fn resolve_or_create_name_point(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    if let Some(id) = find_name_point(conn, name)? {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO points(meta, is_cited, created_at, color, parent_id, path, depth, sort_order)
         VALUES(?1, 0, datetime('now', 'localtime'), NULL, NULL, NULL, NULL, 0)",
        params![name],
    )?;
    Ok(conn.last_insert_rowid())
}

/// 改名一个关系名点:改点 `meta`,引用它的**每条线**的名字文本随之改变(已定口径 3)。
/// 目标 `meta` 已是另一个纯名字点 → 中文报错拒绝(与改名撞名同构);库里零变化。
pub fn rename_line_name(
    conn: &mut Connection,
    name_id: i64,
    new_name: &str,
) -> Result<(), String> {
    if new_name.is_empty() {
        return Err("关系名不能为空;要清除名字请用 set_tag_relation 传空串".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let is_name_point: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM lines WHERE name_id = ?1)",
            params![name_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !is_name_point {
        return Err(format!("名字点不存在: {name_id}"));
    }
    let collision: Option<i64> = tx
        .query_row(
            "SELECT p.id FROM points p
              WHERE p.meta = ?1 AND p.id <> ?2
                AND EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id)
                AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = p.id OR t.to_id = p.id)
              LIMIT 1",
            params![new_name, name_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if collision.is_some() {
        return Err(format!("名字「{new_name}」已存在,不能改成重名"));
    }
    tx.execute("UPDATE points SET meta = ?1 WHERE id = ?2", params![new_name, name_id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// 细粒度建一条线 `from -> to`,返回新线 id。`name_id = None` = 无名字线,
/// `Some(id)` = 有名字线;同一对点 + 同一名字只允许一条(唯一索引兜底,重复给中文错)。
/// 两端必须存在;非树线(`name_id <> 保留点`)拒绝成环(与 `set_tag_relation` 同口径)。
pub fn create_line(
    conn: &mut Connection,
    from_id: i64,
    to_id: i64,
    name_id: Option<i64>,
) -> Result<i64, String> {
    if from_id == to_id {
        return Err("线不能指向自己：两端不能是同一个点".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for id in [from_id, to_id] {
        let exists: bool = tx
            .query_row("SELECT EXISTS(SELECT 1 FROM points WHERE id = ?1)", params![id], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;
        if !exists {
            return Err(format!("点不存在: {id}"));
        }
    }
    if let Some(nid) = name_id {
        let exists: bool = tx
            .query_row("SELECT EXISTS(SELECT 1 FROM points WHERE id = ?1)", params![nid], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;
        if !exists {
            return Err(format!("名字点不存在: {nid}"));
        }
    }
    if name_id != Some(TREE_NAME_ID) && reaches(&tx, to_id, from_id).map_err(|e| e.to_string())? {
        return Err("会形成循环：新线会让目标绕回起点".into());
    }
    let inserted = tx.execute(
        "INSERT INTO lines(from_id, to_id, name_id, created_at)
         VALUES(?1, ?2, ?3, datetime('now', 'localtime'))",
        params![from_id, to_id, name_id],
    );
    let id = match inserted {
        Ok(_) => tx.last_insert_rowid(),
        Err(e) if e.to_string().contains("UNIQUE constraint failed") => {
            return Err("该线已存在：同一对点 + 同一名字只能有一条线".into());
        }
        Err(e) => return Err(e.to_string()),
    };
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

/// 按 id 删一条线(幂等:不存在也算成功)。名字点若无别的线引用,由 GC(T3.3)回收。
pub fn remove_line(conn: &Connection, line_id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM lines WHERE id = ?1", params![line_id])?;
    Ok(())
}

#[cfg(test)]
#[path = "line_name_tests.rs"]
mod line_name_tests;

#[cfg(test)]
#[path = "line_name_probe_tests.rs"]
mod line_name_probe_tests;
