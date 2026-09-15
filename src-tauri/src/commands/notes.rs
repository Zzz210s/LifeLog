use crate::db::repos;
use crate::db::Db;
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub fn save_input_note(app: AppHandle, content: String) -> Result<repos::notes::Note, String> {
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let note = repos::notes::create(&mut conn, &content).map_err(|e| e.to_string())?;
    drop(conn);
    // 跨窗通知:输入栏保存后主窗在空闲时自动刷新,新笔记无需手动操作即可见
    let _ = app.emit("note-created", note.id);
    Ok(note)
}

/// 流查询:结构化条件(关键词/标签/排除/日期/有无标签/排序)+ 行偏移分页
#[tauri::command]
pub fn query_notes(
    app: AppHandle,
    conditions: repos::notes::FilterConditions,
    offset: Option<i64>,
) -> Result<Vec<repos::notes::Note>, String> {
    repos::notes::validate_conditions(&conditions)?;
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::notes::query(&conn, &conditions, offset.unwrap_or(0))
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

/// 改期:解链该笔记的全部时间标签,再链到 `时间排序/YYYY/MM/DD`(自愈,冲突收敛为一个)。
/// date 非法给中文错误;id 不存在返回 null;正文与普通标签不动。
#[tauri::command]
pub fn set_note_date(
    app: AppHandle,
    note_id: i64,
    date: String,
) -> Result<Option<repos::notes::Note>, String> {
    if !crate::timetag::is_iso_date(&date) {
        return Err("日期格式不正确".to_string());
    }
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::notes::set_date(&mut conn, note_id, &date).map_err(|e| e.to_string())
}

/// 切换 #todo/#done 标签;均无则原样返回
#[tauri::command]
pub fn toggle_todo(app: AppHandle, id: i64) -> Result<Option<repos::notes::Note>, String> {
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::notes::toggle_todo(&mut conn, id).map_err(|e| e.to_string())
}
