use crate::db::Db;
use crate::exchange;
use tauri::{AppHandle, Manager, State};

/// 导出全部日记为 xlsx 并写入用户选择的路径
#[tauri::command]
pub fn export_diary(app: AppHandle, path: String) -> Result<(), String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let bytes = exchange::diary_export::export_diary(&conn)?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}
