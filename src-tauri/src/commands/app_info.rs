use crate::db::data_dir_copy::DB_FILE;
use crate::db::Db;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// 设置页「通用」分区需要的只读信息
#[derive(Serialize)]
pub struct DbInfo {
    /// 数据库文件绝对路径(app_data_dir + 主库文件名,与 db::init 打开的是同一个文件)
    pub path: String,
    /// 笔记条数:只做 COUNT(*),不碰任何既有写入逻辑
    pub notes: u64,
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
    let notes: i64 = conn
        .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(DbInfo {
        path: path.to_string_lossy().to_string(),
        notes: notes.max(0) as u64,
    })
}
