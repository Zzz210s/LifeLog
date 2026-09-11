use crate::db::Db;
use crate::exchange;
use tauri::{AppHandle, Manager, State};

/// 导出全部日记为 xlsx 并写入用户选择的路径
/// (async) 使命令在独立任务线程执行,不阻塞主线程;锁内仅生成字节,写盘在锁外
#[tauri::command(async)]
pub fn export_diary(app: AppHandle, path: String) -> Result<(), String> {
    let db: State<Db> = app.state();
    let bytes = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        exchange::diary_export::export_diary(&conn)?
    };
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}
