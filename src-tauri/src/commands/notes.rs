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

/// 流查询:关键词(FTS/LIKE 自适应)+ 标签 AND + 分页排序
#[tauri::command]
pub fn query_notes(
    app: AppHandle,
    keyword: Option<String>,
    tags: Vec<String>,
    offset: i64,
    limit: i64,
    oldest_first: bool,
) -> Result<Vec<repos::notes::Note>, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let filter =
        repos::notes::NoteFilter { keyword, tags, offset, limit, oldest_first };
    repos::notes::query(&conn, &filter).map_err(|e| e.to_string())
}

/// 标签使用计数(筛选栏 chips 数据源)
#[tauri::command]
pub fn tag_counts(app: AppHandle) -> Result<Vec<(String, i64)>, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(repos::notes::count_tags(&conn))
}

#[tauri::command]
pub fn delete_note(app: AppHandle, id: i64) -> Result<(), String> {
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::notes::delete(&mut conn, id).map_err(|e| e.to_string())
}

/// 更新笔记正文(替换语义重写标签链);id 不存在返回 null
#[tauri::command]
pub fn update_note(
    app: AppHandle,
    id: i64,
    content: String,
) -> Result<Option<repos::notes::Note>, String> {
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::notes::update(&mut conn, id, &content).map_err(|e| e.to_string())
}

/// 切换 #todo/#done 标签;均无则原样返回
#[tauri::command]
pub fn toggle_todo(app: AppHandle, id: i64) -> Result<Option<repos::notes::Note>, String> {
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::notes::toggle_todo(&mut conn, id).map_err(|e| e.to_string())
}
