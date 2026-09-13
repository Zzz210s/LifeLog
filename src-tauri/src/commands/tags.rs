//! 标签树命令层(MVP-2 Task 4):只做参数校验与转调仓库层,不写 SQL。
//! 删除前的影响面由独立的 `tag_impact` 提供(前端二次确认后再调 `delete_tag`)。
use crate::db::repos::tags_tree::{self, TagCount};
use crate::db::Db;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// 删除前的二次确认数据:将影响的子孙标签数与笔记数(笔记已去重)
#[derive(Serialize, Debug, PartialEq)]
pub struct TagImpact {
    pub tags: i64,
    pub notes: i64,
}

/// 取库连接并转调:锁中毒等基础设施错误统一转字符串
fn with_conn<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    f(&mut conn)
}

/// 全部标签及本级/含子级计数(标签面板与筛选栏数据源)
#[tauri::command]
pub fn list_tags(app: AppHandle) -> Result<Vec<TagCount>, String> {
    with_conn(&app, |c| tags_tree::counts(c).map_err(|e| e.to_string()))
}

/// 改标签名(单段名称);级联重写子树路径与全文索引
#[tauri::command]
pub fn rename_tag(app: AppHandle, tag_id: i64, new_name: String) -> Result<(), String> {
    if new_name.trim().is_empty() {
        return Err("标签名不能为空".into());
    }
    with_conn(&app, |c| tags_tree::rename(c, tag_id, new_name.trim()))
}

/// 移动标签(含环检测与深度上限);new_parent_id 为 null 表示移到根级
#[tauri::command]
pub fn move_tag(app: AppHandle, tag_id: i64, new_parent_id: Option<i64>) -> Result<(), String> {
    with_conn(&app, |c| tags_tree::move_to(c, tag_id, new_parent_id))
}

/// 删除子树(解除链接、回收空容器、重写全文索引);笔记永不因删标签而消失
#[tauri::command]
pub fn delete_tag(app: AppHandle, tag_id: i64) -> Result<(), String> {
    with_conn(&app, |c| tags_tree::delete_subtree(c, tag_id))
}

/// 删除前的影响面读数(供二次确认弹窗)
#[tauri::command]
pub fn tag_impact(app: AppHandle, tag_id: i64) -> Result<TagImpact, String> {
    with_conn(&app, |c| {
        tags_tree::impact(c, tag_id)
            .map(|(tags, notes)| TagImpact { tags, notes })
            .map_err(|e| e.to_string())
    })
}

/// 路径前缀补全(输入 `#工作/` 时列出下一级候选)
#[tauri::command]
pub fn complete_tags(app: AppHandle, prefix: Option<String>) -> Result<Vec<String>, String> {
    let prefix = prefix.unwrap_or_default();
    with_conn(&app, |c| {
        tags_tree::complete(c, &prefix).map_err(|e| e.to_string())
    })
}
