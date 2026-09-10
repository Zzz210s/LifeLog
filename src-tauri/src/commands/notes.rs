use crate::db::repos;
use crate::db::Db;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn save_quick_note(app: AppHandle, content: String) -> Result<repos::notes::Note, String> {
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::notes::create(&mut conn, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_recent_notes(
    app: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<repos::notes::Note>, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::notes::recent(&conn, limit.unwrap_or(20)).map_err(|e| e.to_string())
}
