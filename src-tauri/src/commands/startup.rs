// 开机启动命令:执行者是 tauri-plugin-autostart,前端不直接依赖它的命令与权限,统一走这里。
// 关键点:插件的 enable()/disable() 返回 Ok 并不等于注册表真的改了(可能被安全软件拦下),
// 所以每次写后都回读真实状态校验,不一致时把错误交给界面显示「需要修复」。
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// 注册表里的真实开机启动状态(界面上的"期望值"存在设置键 input_autostart 里)
#[derive(Serialize)]
pub struct AutostartStatus {
    pub enabled: bool,
}

#[tauri::command]
pub fn get_autostart_status(app: AppHandle) -> Result<AutostartStatus, String> {
    let enabled = app
        .autolaunch()
        .is_enabled()
        .map_err(|e| format!("读取开机启动状态失败: {e}"))?;
    Ok(AutostartStatus { enabled })
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let write = if enabled { manager.enable() } else { manager.disable() };
    write.map_err(|e| format!("{}开机启动失败: {e}", if enabled { "启用" } else { "关闭" }))?;
    let actual = manager
        .is_enabled()
        .map_err(|e| format!("回读开机启动状态失败: {e}"))?;
    if actual != enabled {
        return Err(format!(
            "开机启动未生效:系统当前为{}",
            if actual { "已启用" } else { "已关闭" }
        ));
    }
    Ok(())
}
