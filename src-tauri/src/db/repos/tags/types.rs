//! 标签类型(types)数据层(spec 2026-10-05 / 计划 Task 6):
//! 「哪些标签能当类型」= `tags.is_type` 开关(标签上的一个布尔);
//! 「X 是 Y 类型的」= `tag_links` 的 `(tag_id = X, target_type = 'type', target_id = Y)` 行。
//! 类型不参与 tag 树的父子关系,也不改 path/depth/sort_order(R5)。
//! `tag_links.target_id` 无外键:取消类型登记与删除标签都必须显式清理指向它的 'type' 行
//! (见 set_tag_type_flag / gc_orphans / delete_subtree)。
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// 类型读数(tag_id + 完整路径 + 路径末段名);`name` 每次由路径现算,改名后自动跟随
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypeRef {
    pub tag_id: i64,
    pub path: String,
    pub name: String,
}

/// 该标签是否已登记为类型(R3 校验的唯一判据;被 carry 复用)。标签不存在返回 false。
pub fn is_type(conn: &Connection, tag_id: i64) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT is_type FROM tags WHERE id = ?1",
        params![tag_id],
        |r| r.get::<_, i64>(0),
    )
    .optional()
    .map(|v| v.unwrap_or(0) != 0)
}

/// 设置或取消某标签的「类型」标记(幂等):同值重复调用不报错。
/// 取消时连带删掉所有指向它的 'type' 行(避免留下指向非类型标签的关系)。整事务。
pub fn set_tag_type_flag(conn: &Connection, tag_id: i64, is_type: bool) -> Result<(), String> {
    ensure_tag(conn, tag_id)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE tags SET is_type = ?2 WHERE id = ?1",
        params![tag_id, is_type],
    )
    .map_err(|e| e.to_string())?;
    if !is_type {
        tx.execute(
            "DELETE FROM tag_links WHERE target_type = 'type' AND target_id = ?1",
            params![tag_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// 整体替换某标签的类型认领(不是增量):先清空再写入,整事务。
/// 目标标签必须存在且 `is_type=1`,否则中文错且零变化。
pub fn set_tag_types(conn: &mut Connection, tag_id: i64, type_tag_ids: Vec<i64>) -> Result<(), String> {
    ensure_tag(conn, tag_id)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for type_tag_id in &type_tag_ids {
        if !is_type(&tx, *type_tag_id).map_err(|e| e.to_string())? {
            return Err(format!("认领的类型必须是已登记的类型标签: {type_tag_id}"));
        }
    }
    tx.execute(
        "DELETE FROM tag_links WHERE tag_id = ?1 AND target_type = 'type'",
        params![tag_id],
    )
    .map_err(|e| e.to_string())?;
    for type_tag_id in &type_tag_ids {
        tx.execute(
            "INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'type', ?2)",
            params![tag_id, type_tag_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// 全部已登记类型(按路径升序);没有登记时为空
pub fn list_types(conn: &Connection) -> rusqlite::Result<Vec<TypeRef>> {
    query_types(
        conn,
        "SELECT t.id, t.path FROM tags t WHERE t.is_type = 1 ORDER BY t.path",
        rusqlite::params![],
    )
}

/// 某标签认领的全部类型(按路径升序)
pub fn list_tag_types(conn: &Connection, tag_id: i64) -> rusqlite::Result<Vec<TypeRef>> {
    query_types(
        conn,
        "SELECT t.id, t.path FROM tag_links l JOIN tags t ON t.id = l.target_id \
         WHERE l.tag_id = ?1 AND l.target_type = 'type' ORDER BY t.path",
        rusqlite::params![tag_id],
    )
}

/// 标签不存在则中文报错(类型关系都指向真实标签,先校验再写)
fn ensure_tag(conn: &Connection, tag_id: i64) -> Result<(), String> {
    let exists: Option<i64> = conn
        .query_row("SELECT 1 FROM tags WHERE id = ?1", params![tag_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if exists.is_none() {
        return Err(format!("标签不存在: {tag_id}"));
    }
    Ok(())
}

/// 路径末段(类型名);`/` 是路径分隔符,单段路径即整串
pub(super) fn leaf(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

/// 按 SQL 取 (tag_id, path) 两列并补出 name(两条查询同形)
fn query_types<P: rusqlite::Params>(
    conn: &Connection,
    sql: &str,
    params: P,
) -> rusqlite::Result<Vec<TypeRef>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params, |r| {
        let path: String = r.get(1)?;
        Ok(TypeRef { tag_id: r.get(0)?, name: leaf(&path), path })
    })?;
    rows.collect()
}

#[cfg(test)]
#[path = "types_tests.rs"]
mod types_tests;

#[cfg(test)]
#[path = "types_carry_tests.rs"]
mod types_carry_tests;
