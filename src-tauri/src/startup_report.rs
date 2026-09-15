//! 启动期数据库故障的可见提示:用系统对话框把"迁移/备份失败"告诉用户,
//! 而不是让 setup 里的 `?` 直接 panic(用户只看到闪退,拿不到任何原因)。
//!
//! API 依据(tauri-plugin-dialog 2.7.3,本机 ~/.cargo/registry 源码核对):
//! - `AppHandle::dialog()` 由 `DialogExt` 提供,返回 `MessageDialogBuilder`;
//! - 在 setup(主线程)里只能用非阻塞的 `show(callback)`:它的实现
//!   (desktop.rs::show_message_dialog)先 `AppHandle::run_on_main_thread` 把对话框创建
//!   投递进事件循环,再用 `std::thread::spawn` + `block_on` 等结果并执行回调 —— 因此
//!   setup 返回后对话框才被创建,主线程不会被卡住(回调在独立线程上执行)。
//! - `blocking_show()` 插件文档明确写着 "should *NOT* be used when running on the main
//!   thread context"(会冻结应用),setup 正是主线程,故不使用。
//! - 退出码不能交给 `AppHandle::exit(1)` 传递(实测为 0),详见 [`show_failure`] 内注释。
//! - 按钮文案用 `MessageDialogButtons::OkCustom("确定")`:插件给 rfd 开了
//!   common-controls-v6 特性,Windows 走 TaskDialogIndirect,支持自定义按钮文本。
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::db::OpenFailure;

/// 失败对话框正文(纯函数,便于单测):原因 + 数据库位置 + 已生成的备份 + 结论
pub fn failure_message(failure: &OpenFailure, db_path: Option<&Path>) -> String {
    let mut msg = format!(
        "数据库初始化失败,应用即将退出。\n\n原因:{}\n数据库位置:{}\n",
        failure.reason,
        display_path(db_path)
    );
    if let Some(backup) = &failure.backup {
        msg.push_str(&format!("迁移前已生成的备份:{}\n", backup.display()));
    }
    msg.push_str("\n数据库未被修改,请把上面的信息反馈给我。");
    msg
}

/// 备份失败(迁移已成功)对话框正文(纯函数)
pub fn backup_warning_message(warning: &str, db_path: Option<&Path>) -> String {
    format!(
        "数据库已成功升级到最新版本,但升级前的自动备份没有生成。\n\n原因:{warning}\n\
         数据库位置:{}\n\n应用可以正常使用;将来若需要回退到旧版数据,\
         请把上面的信息反馈给我。",
        display_path(db_path)
    )
}

fn display_path(path: Option<&Path>) -> String {
    path.map(|p| p.display().to_string())
        .unwrap_or_else(|| "未能定位".to_string())
}

/// 数据库文件位置(尽力而为:定位失败也不影响弹窗)
fn db_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(crate::db::data_dir_migration::DB_FILE))
}

/// 弹失败对话框:写明原因与备份位置,用户确认后以退出码 1 退出(不 panic)。
/// `title` 由调用方给出(数据目录迁移失败 / 数据库初始化失败),正文原因一致。
pub fn show_failure(app: &AppHandle, title: &str, failure: &OpenFailure) {
    let path = db_file(app);
    let message = failure_message(failure, path.as_deref());
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::OkCustom("确定".to_string()))
        .show(move |_| {
            // 不能只调 AppHandle::exit(1):tauri-runtime-wry 处理 RequestExit 时把控制流置为
            // ControlFlow::Exit(= ExitWithCode(0)),tao 的 run() 随后以 0 结束进程 —— 本机实测
            // process::exit 之前退出码拿不到 1(冒烟/py 脚本读到 0)。此处 setup 刚开头就失败,
            // 数据库连接已在 open() 里回滚并释放、托盘与热键都还没建,没有常驻资源需要收尾,
            // 故用户确认后直接以退出码 1 结束进程。
            std::process::exit(1);
        });
}

/// 弹「数据库备份失败」警告:不退出,迁移已完成、应用照常可用
pub fn show_backup_warning(app: &AppHandle, warning: &str) {
    let path = db_file(app);
    app.dialog()
        .message(backup_warning_message(warning, path.as_deref()))
        .title("数据库备份失败")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn failure(with_backup: bool) -> OpenFailure {
        OpenFailure {
            reason: "数据库迁移失败(原版本 4 -> 最新 6):no such table: main.tags".to_string(),
            backup: with_backup.then(|| PathBuf::from("C:/data/lifelog.db.bak-4-20260912T080000")),
        }
    }

    #[test]
    fn failure_message_carries_reason_backup_and_reassurance() {
        let msg = failure_message(&failure(true), Some(Path::new("C:/data/lifelog.db")));
        assert!(msg.contains("数据库迁移失败"), "{msg}");
        assert!(msg.contains("C:/data/lifelog.db"), "应写明数据库位置: {msg}");
        assert!(
            msg.contains("lifelog.db.bak-4-20260912T080000"),
            "应给出备份文件名与目录: {msg}"
        );
        assert!(msg.contains("数据库未被修改"), "{msg}");
    }

    #[test]
    fn failure_message_without_backup_omits_backup_line() {
        let msg = failure_message(&failure(false), None);
        assert!(!msg.contains("备份"), "没有备份就不该出现备份字样: {msg}");
        assert!(msg.contains("未能定位"), "位置未知时应说明: {msg}");
    }

    #[test]
    fn backup_warning_says_migration_succeeded() {
        let msg = backup_warning_message("磁盘已满", Some(Path::new("C:/data/lifelog.db")));
        assert!(msg.contains("已成功升级"), "{msg}");
        assert!(msg.contains("备份没有生成"), "{msg}");
        assert!(msg.contains("磁盘已满"), "{msg}");
        assert!(msg.contains("可以正常使用"), "{msg}");
    }
}
