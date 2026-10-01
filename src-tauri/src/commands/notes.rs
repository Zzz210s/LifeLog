use crate::db::repos;
use crate::db::Db;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(test)]
#[path = "notes_complete_tests.rs"]
mod notes_complete_tests;

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

/// 流查询:结构化条件(关键词/标签/排除/有无标签/排序)+ 行偏移分页
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

/// 一页笔记的被引用计数(`target_id -> 引用条数`):**一次 `IN (...)` 批量取全**,
/// 前端把 Map 分给各卡(设计 §3.0:50 张卡不能 50 次查询)。
#[tauri::command]
pub fn note_link_counts(app: AppHandle, note_ids: Vec<i64>) -> Result<HashMap<i64, i64>, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::note_links::list_links_page(&conn, &note_ids).map_err(|e| e.to_string())
}

/// 单条笔记的出链 + 入链(卡片面板与编辑面板的反向引用列表,点开时才拉)。
/// 入链按来源 id 升序,同一来源只出现一次(DISTINCT)。
#[tauri::command]
pub fn note_links(app: AppHandle, note_id: i64) -> Result<repos::note_links::NoteLinks, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::note_links::list_note_links(&conn, note_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_note(app: AppHandle, id: i64) -> Result<(), String> {
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::notes::delete(&mut conn, id).map_err(|e| e.to_string())
}

/// `[[` 补全的候选池:全部笔记的显示首行(前缀粗筛,上限 200)。
/// **空前缀回整池**(前端按 dataVersion 会话内缓存,不每键打 IPC);只读,不改库。
#[tauri::command]
pub fn complete_notes(
    app: AppHandle,
    prefix: Option<String>,
) -> Result<Vec<repos::notes::NoteTitle>, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let all = repos::notes::all_titles(&conn).map_err(|e| e.to_string())?;
    Ok(repos::notes::pick_titles(all, prefix.as_deref().unwrap_or("")))
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

