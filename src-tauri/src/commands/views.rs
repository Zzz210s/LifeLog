//! 视图命令层(MVP-3 Task 2):只做参数校验与转调仓库层,不写 SQL。
//! 内置视图(全部/待办/无自定义标签)是前端代码常量,不经命令;命中计数批量返回供侧栏徽标。
//! 参数校验(标题边界、重名、条件合法性、排序清单完整性)与中文错误都在仓库层。
use crate::db::repos::notes::FilterConditions;
use crate::db::repos::views::{self, SavedView};
use crate::db::Db;
use tauri::{AppHandle, Manager, State};

/// 全部自建视图(按 sort_order 升序)
#[tauri::command]
pub fn list_views(app: AppHandle) -> Result<Vec<SavedView>, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    views::list(&conn)
}

/// 新建视图(标题 + 条件 + 图标名);返回新视图 id。图标名非法/超长时中文报错且不落库。
#[tauri::command]
pub fn create_view(
    app: AppHandle,
    title: String,
    conditions: FilterConditions,
    icon: Option<String>,
) -> Result<i64, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    views::create(&conn, &title, &conditions, icon.as_deref())
}

/// 改名、替换条件并重写图标(icon=null 即清空);条件/标题/图标非法时拒绝且不落库
#[tauri::command]
pub fn update_view(
    app: AppHandle,
    id: i64,
    title: String,
    conditions: FilterConditions,
    icon: Option<String>,
) -> Result<(), String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    views::update(&conn, id, &title, &conditions, icon.as_deref())
}

/// 删除自建视图(内置视图不入表,不经此命令)
#[tauri::command]
pub fn delete_view(app: AppHandle, id: i64) -> Result<(), String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    views::remove(&conn, id)
}

/// 拖拽排序:ids 须为全部自建视图的新顺序,整批重写 sort_order(单事务)
#[tauri::command]
pub fn reorder_views(app: AppHandle, ids: Vec<i64>) -> Result<(), String> {
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    views::reorder(&mut conn, &ids)
}

/// 批量命中计数:键为 all / todo / untagged / view:<id>(内置在前,自建按 sort_order)
#[tauri::command]
pub fn count_view_hits(app: AppHandle) -> Result<Vec<(String, i64)>, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    views::hit_counts(&conn)
}
