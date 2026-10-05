//! 标签角色(roles)与认领(tag_roles)数据层(spec 2026-10-05 §3 §4):
//! roles 一行 = 一个角色,tag_id 指向真实标签(角色名 = 该标签路径末段,改名自动跟随);
//! tag_roles 一行 = "标签 tag_id 被角色 role_id 认领",多对多,主键天然去重(重复认领幂等)。
//!
//! 与 tags 主树零耦合:角色不参与父子关系,也不改 path/depth/sort_order(R5)。
//! 删除被登记/被认领的标签由 roles.tag_id / tag_roles.tag_id 的 ON DELETE CASCADE 清理
//! (db::open 已开 foreign_keys=ON);`unregister_role` 另外显式删本角色的认领行,不单靠外键。
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// 角色读数(tag_id + 完整路径 + 路径末段名);`name` 每次由路径现算,改名后自动跟随
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoleRef {
    pub tag_id: i64,
    pub path: String,
    pub name: String,
}

/// 该标签是否已登记为角色(R3 校验的唯一判据;被 carry 复用)。标签不存在返回 false。
pub fn is_role(conn: &Connection, tag_id: i64) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT 1 FROM roles WHERE tag_id = ?1",
        params![tag_id],
        |_| Ok(()),
    )
    .optional()
    .map(|v| v.is_some())
}

/// 登记角色(幂等):同一标签重复登记不增行;标签不存在给中文错。
pub fn register_role(conn: &Connection, tag_id: i64) -> Result<(), String> {
    ensure_tag(conn, tag_id)?;
    conn.execute(
        "INSERT OR IGNORE INTO roles(tag_id, sort_order) \
         VALUES(?1, COALESCE((SELECT MAX(sort_order) + 1 FROM roles), 0))",
        params![tag_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 取消登记(幂等):连带删掉该角色的全部认领行;标签没被登记也算成功。整事务。
pub fn unregister_role(conn: &mut Connection, tag_id: i64) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM tag_roles WHERE role_id = (SELECT id FROM roles WHERE tag_id = ?1)",
        params![tag_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM roles WHERE tag_id = ?1", params![tag_id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// 整体替换某标签的角色认领(不是增量):先清空再写入,整事务。
/// 目标标签必须存在,每个 role_id 都必须是已登记的角色标签,否则中文错且零变化。
pub fn set_tag_roles(conn: &mut Connection, tag_id: i64, role_ids: Vec<i64>) -> Result<(), String> {
    ensure_tag(conn, tag_id)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for role_tag_id in &role_ids {
        if !is_role(&tx, *role_tag_id).map_err(|e| e.to_string())? {
            return Err(format!("认领的角色必须是已登记的角色标签: {role_tag_id}"));
        }
    }
    tx.execute("DELETE FROM tag_roles WHERE tag_id = ?1", params![tag_id])
        .map_err(|e| e.to_string())?;
    for role_tag_id in &role_ids {
        tx.execute(
            "INSERT OR IGNORE INTO tag_roles(tag_id, role_id) \
             SELECT ?1, id FROM roles WHERE tag_id = ?2",
            params![tag_id, role_tag_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// 全部已登记角色(按 sort_order 再按路径);空表时为空
pub fn list_roles(conn: &Connection) -> rusqlite::Result<Vec<RoleRef>> {
    query_roles(
        conn,
        "SELECT r.tag_id, t.path FROM roles r JOIN tags t ON t.id = r.tag_id \
         ORDER BY r.sort_order, t.path",
        rusqlite::params![],
    )
}

/// 某标签认领的全部角色(按路径)
pub fn list_tag_roles(conn: &Connection, tag_id: i64) -> rusqlite::Result<Vec<RoleRef>> {
    query_roles(
        conn,
        "SELECT r.tag_id, t.path FROM tag_roles tr JOIN roles r ON r.id = tr.role_id \
         JOIN tags t ON t.id = r.tag_id WHERE tr.tag_id = ?1 ORDER BY t.path",
        rusqlite::params![tag_id],
    )
}

/// 标签不存在则中文报错(roles/tag_roles 都是指向真实标签的关系,先校验再写)
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

/// 路径末段(角色名);`/` 是路径分隔符,单段路径即整串
fn leaf(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

/// 按 SQL 取 (tag_id, path) 两列并补出 name(两条查询同形)
fn query_roles<P: rusqlite::Params>(
    conn: &Connection,
    sql: &str,
    params: P,
) -> rusqlite::Result<Vec<RoleRef>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params, |r| {
        let path: String = r.get(1)?;
        Ok(RoleRef { tag_id: r.get(0)?, name: leaf(&path), path })
    })?;
    rows.collect()
}

#[cfg(test)]
#[path = "roles_tests.rs"]
mod roles_tests;

#[cfg(test)]
#[path = "roles_carry_tests.rs"]
mod roles_carry_tests;
