//! 启动动作决策与托盘窗口入口。
//! 决策纯逻辑与前端 src/shared/startup-action.ts 同构(两侧各有单测钉住同一真值表):
//! 动作只由设置「启动时显示」input_startup_show 决定,手动启动与开机自启一致(spec 3.1);
//! 主窗口在任何情况下都不自动显示(关闭 = 退到托盘)。
use crate::windowing;
use tauri::{AppHandle, Emitter, Manager};

/// 启动后做什么:唤起输入栏 / 只驻留托盘(不显示任何窗口)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupAction {
    ShowInput,
    TrayOnly,
}

/// input_startup_show 的白名单解析:'tray-only' 之外(缺失、空串、未知值)一律按默认
/// 'input-bar' 处理,与前端 parseStartupSettings 的回退规则一致。
pub fn show_input_from_setting(raw: Option<&str>) -> bool {
    raw != Some("tray-only")
}

/// 纯函数:show_input=false(设置为仅托盘)才静默进托盘。
/// autostart_launch 是本次拉起方式(自启带 --minimized):两种方式动作一致,不参与判定。
pub fn resolve_startup_action(show_input: bool, _autostart_launch: bool) -> StartupAction {
    if show_input {
        StartupAction::ShowInput
    } else {
        StartupAction::TrayOnly
    }
}

/// setup 末尾调用:读设置 -> 执行启动动作。主窗口永不自动显示。
pub fn apply(app: &AppHandle, autostart_launch: bool) {
    let raw = windowing::input_geom::get_str(app, "input_startup_show");
    let show_input = show_input_from_setting(raw.as_deref());
    match resolve_startup_action(show_input, autostart_launch) {
        // 沿用既有输入栏唤起实现(恢复记忆几何/缩放/置顶后 show + 聚焦)
        StartupAction::ShowInput => {
            if let Err(e) = windowing::input::show(app) {
                eprintln!("启动显示输入栏失败(仍可从托盘/热键唤起):{e}");
            }
        }
        // 仅托盘:不显示任何窗口,进程驻留托盘等待唤起点
        StartupAction::TrayOnly => {}
    }
}

/// 显示主窗口(托盘「打开主窗口」/「设置」共用)。找不到窗口时不报错,只当无事发生。
pub fn open_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("main") {
        w.show()?;
        w.set_focus()?;
    }
    Ok(())
}

/// 显示主窗口并切到设置页:先 show+focus,再发事件让主窗把视图切到设置
/// (事件名与前端 use-open-settings.ts 的 OPEN_SETTINGS_EVENT 一致)
pub fn open_settings_window(app: &AppHandle) -> tauri::Result<()> {
    open_main_window(app)?;
    let _ = app.emit("open-settings", ());
    Ok(())
}

#[cfg(test)]
#[path = "startup_tests.rs"]
mod startup_tests;
