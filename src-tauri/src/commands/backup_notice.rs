use crate::db::backup_warning;

/// 主窗启动时取一次「迁移前备份失败」提示:取值即清空,不重复提示。
/// 返回 None 表示本次启动没有备份失败(或已被取走)。
#[tauri::command]
pub fn take_backup_warning() -> Option<String> {
    backup_warning::take()
}
