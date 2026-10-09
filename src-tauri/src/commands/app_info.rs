use crate::db::data_dir_copy::DB_FILE;
use crate::db::Db;
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// 设置页「通用」分区需要的只读信息
#[derive(Serialize)]
pub struct DbInfo {
    /// 数据库文件绝对路径(app_data_dir + 主库文件名,与 db::init 打开的是同一个文件)
    pub path: String,
    /// 条目数:统一实体后 = `COUNT(*) FROM entities`(笔记 + 标签,spec §6.6)
    pub entities: u64,
}

/// 条目总数(全部实体):设置页「条目 N 条」的唯一口径真源,便于单测
pub fn count_entities(conn: &Connection) -> Result<u64, String> {
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM entities", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(n.max(0) as u64)
}

#[tauri::command]
pub fn get_db_info(app: AppHandle) -> Result<DbInfo, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(DB_FILE);
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let entities = count_entities(&conn)?;
    Ok(DbInfo {
        path: path.to_string_lossy().to_string(),
        entities,
    })
}

#[cfg(test)]
#[path = "app_info_tests.rs"]
mod app_info_tests;
