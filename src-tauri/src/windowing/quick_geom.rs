//! 快捷窗几何/视图设置键的存取,以及「旧几何语义 -> 基础尺寸」的一次性迁移。
//! 迁移在**单个事务**里同时写 quick_w、quick_h 与版本标记后一次提交,任一失败整体回滚:
//! 既不会出现「两键已改、标记未写」(下次启动会把新语义再除一次,窗口越迁越窄,不可逆),
//! 也不会出现「标记已写、两键未改」(尺寸语义永久不一致)。

use super::quick_scale::migrate_size;
use crate::db::repos::settings as repo;
use rusqlite::Connection;
use tauri::{AppHandle, Manager};

/// 几何语义版本标记键:存在即视为已迁移(幂等)
pub const GEOM_VERSION_KEY: &str = "quick_geom_ver";

/// 读设置(字符串);DB 未托管或读取失败返回 None
pub fn get_str(app: &AppHandle, key: &str) -> Option<String> {
    let db = app.try_state::<crate::db::Db>()?;
    let conn = db.0.lock().ok()?;
    repo::get(&conn, key).ok().flatten()
}

/// 读设置(数值);缺失或无法解析返回 None
pub fn get_num(app: &AppHandle, key: &str) -> Option<f64> {
    get_str(app, key)?.trim().parse::<f64>().ok()
}

/// 写设置;失败静默(窗口几何的兜底写回,不阻断窗口操作)
pub fn set(app: &AppHandle, key: &str, value: &str) {
    if let Some(db) = app.try_state::<crate::db::Db>() {
        if let Ok(conn) = db.0.lock() {
            let _ = repo::set(&conn, key, value);
        }
    }
}

/// 迁移核心(可在内存库上测试):标记已存在时返回 Ok(None) 且不改任何键;
/// 否则在**同一事务**里写 quick_w、quick_h 与标记后一次提交,返回 Ok(Some(迁移后基础尺寸))。
/// 任一写入失败返回 Err 并回滚,标记不落库(下次启动重新尝试)。
pub fn migrate_conn(conn: &mut Connection) -> rusqlite::Result<Option<(u32, u32)>> {
    if repo::get(conn, GEOM_VERSION_KEY)?.is_some() {
        return Ok(None);
    }
    let num = |key: &str| -> Option<f64> {
        repo::get(conn, key)
            .ok()
            .flatten()
            .and_then(|v| v.trim().parse::<f64>().ok())
    };
    let geom = match (num("quick_w"), num("quick_h"), num("quick_zoom")) {
        (Some(w), Some(h), Some(zoom)) => Some(migrate_size(w, h, zoom)),
        _ => None,
    };
    let tx = conn.transaction()?;
    if let Some((bw, bh)) = geom {
        repo::set(&tx, "quick_w", &bw.to_string())?;
        repo::set(&tx, "quick_h", &bh.to_string())?;
    }
    repo::set(&tx, GEOM_VERSION_KEY, "1")?;
    tx.commit()?;
    Ok(geom)
}

/// 启动时调用一次:旧几何(含缩放的尺寸)迁移到新语义(基础物理尺寸),幂等
pub fn migrate_geometry(app: &AppHandle) {
    let Some(db) = app.try_state::<crate::db::Db>() else {
        return;
    };
    let Ok(mut conn) = db.0.lock() else {
        eprintln!("几何语义迁移跳过:数据库连接不可用");
        return;
    };
    if let Err(e) = migrate_conn(&mut conn) {
        eprintln!("几何语义迁移失败(已回滚,下次启动重试):{e}");
    }
}

#[cfg(test)]
#[path = "quick_geom_tests.rs"]
mod quick_geom_tests;
