use crate::db::Db;
use crate::exchange;
use tauri::{AppHandle, Manager, State};

/// 导出整库(xlsx) 并写入用户选择的路径
/// (async) 使命令在独立任务线程执行,不阻塞主线程;锁内仅生成字节,写盘在锁外
#[tauri::command(async)]
pub fn export_notes(app: AppHandle, path: String) -> Result<(), String> {
    let db: State<Db> = app.state();
    let bytes = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        exchange::notes_export::export_notes(&conn)?
    };
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// 导出**选中**的条目(spec 2026-10-17 §4.4):显式 id 集,列结构与整库导出一致。
/// 空集直接拒(前端按钮在 0 选时已禁用,这里只是兜底)。
#[tauri::command(async)]
pub fn export_points_of(app: AppHandle, path: String, ids: Vec<i64>) -> Result<(), String> {
    if ids.is_empty() {
        return Err("没有选中任何条目".into());
    }
    let db: State<Db> = app.state();
    let bytes = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        exchange::notes_export_selected::export_selected(&conn, &ids)?
    };
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}
