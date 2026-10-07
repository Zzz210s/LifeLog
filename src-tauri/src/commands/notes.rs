use crate::db::repos;
use crate::db::Db;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(test)]
#[path = "notes_complete_tests.rs"]
mod notes_complete_tests;

/// 笔记表变化事件名(与前端 `use-note-titles.ts` 的 NOTE_CREATED_EVENT / `use-note-created.ts` 同值)
const NOTE_CREATED_EVENT: &str = "note-created";
/// 输入栏窗口标签(`[[` 补全标题池的跨窗失效通知只发给它)
const INPUT_LABEL: &str = "input";

/// 笔记改名/删除后通知输入栏重取标题池(见 `src/input-bar/use-link-complete.ts` 的候选池)。
/// **只发给输入栏**:同名事件被主窗的 `useNoteCreatedRefresh` 订阅着,广播会在每次改名/删除时
/// 把单页信息流拉回第一页(那套语义是「另一窗新建了笔记」)。
fn notify_input_titles_changed(app: &AppHandle, id: i64) {
    let _ = app.emit_to(INPUT_LABEL, NOTE_CREATED_EVENT, id);
}

#[tauri::command]
pub fn save_input_note(app: AppHandle, content: String) -> Result<repos::notes::Note, String> {
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let note = repos::notes::create(&mut conn, &content).map_err(|e| e.to_string())?;
    drop(conn);
    // 跨窗通知:输入栏保存后主窗在空闲时自动刷新,新笔记无需手动操作即可见
    let _ = app.emit(NOTE_CREATED_EVENT, note.id);
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

/// 条件栏「命中 N 条」读数:每个标签 / 类型条件独立计数(不叠加其它条件),
/// 与 query_notes 共用同一套谓词(标签含子级与携带继承、类型认领继承)
#[tauri::command]
pub fn condition_hit_counts(
    app: AppHandle,
    conditions: repos::notes::FilterConditions,
) -> Result<repos::notes_hits::ConditionHits, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::notes_hits::hits(&conn, &conditions)
}

/// 分组骨架(只读):组名 + 每组总数 + 组间顺序键 + `degraded`/`slow` 标志位。
/// 与 `query_notes` 共用同一套条件编译;无 `groupBy` 时报错(调用方不该发这个请求)
#[tauri::command]
pub fn group_skeleton(
    app: AppHandle,
    conditions: repos::notes::FilterConditions,
) -> Result<repos::notes::notes_group::SkeletonResult, String> {
    repos::notes::validate_conditions(&conditions)?;
    let group_by = conditions.group_by.clone().ok_or("没有分组条件")?;
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::notes::notes_group::skeleton(&conn, &conditions, &group_by)
}

/// 分组首屏:一次窗口函数取全所有组的前 `PER_GROUP` 条(组内排序走 `sorts`)
#[tauri::command]
pub fn query_grouped(
    app: AppHandle,
    conditions: repos::notes::FilterConditions,
) -> Result<Vec<repos::notes::notes_group::GroupPage>, String> {
    repos::notes::validate_conditions(&conditions)?;
    let group_by = conditions.group_by.clone().ok_or("没有分组条件")?;
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::notes::notes_group_query::query_grouped(&conn, &conditions, &group_by)
}

/// 组内续页:offset 作用域是**组内**(折叠/展开别的组不影响本组 offset)
#[tauri::command]
pub fn query_group_page(
    app: AppHandle,
    conditions: repos::notes::FilterConditions,
    group_key: Option<String>,
    offset: Option<i64>,
) -> Result<Vec<repos::notes::Note>, String> {
    repos::notes::validate_conditions(&conditions)?;
    let group_by = conditions.group_by.clone().ok_or("没有分组条件")?;
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::notes::notes_group_query::query_group_page(
        &conn,
        &conditions,
        &group_by,
        group_key.as_deref(),
        offset.unwrap_or(0),
    )
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
    repos::notes::delete(&mut conn, id).map_err(|e| e.to_string())?;
    drop(conn);
    notify_input_titles_changed(&app, id);
    Ok(())
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
    let updated = repos::notes::update(&mut conn, id, &content).map_err(|e| e.to_string())?;
    drop(conn);
    if updated.is_some() {
        notify_input_titles_changed(&app, id);
    }
    Ok(updated)
}

