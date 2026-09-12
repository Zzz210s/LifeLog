use crate::db::repos;
use crate::db::Db;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn get_setting(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::settings::get(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::settings::set(&conn, &key, &value).map_err(|e| e.to_string())
}

/// 三档锁定一次性写库:单个事务,要么三键全部生效、要么全不生效
/// (避免解锁只写了一半,界面与库反向偏离)
#[tauri::command]
pub fn set_quick_locks(
    app: AppHandle,
    lock_move: bool,
    lock_close: bool,
    lock_content: bool,
) -> Result<(), String> {
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (key, locked) in [
        ("quick_lock_move", lock_move),
        ("quick_lock_close", lock_close),
        ("quick_lock_content", lock_content),
    ] {
        repos::settings::set(&tx, key, if locked { "true" } else { "false" })
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}
