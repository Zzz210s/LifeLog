//! 启动动作决策与托盘窗口入口。
//! 决策纯逻辑与前端 src/shared/startup-action.ts 同构(两侧各有单测钉住同一真值表):
//! 动作只由设置「启动时显示」input_startup_show 决定,手动启动与开机自启一致(spec 3.1);
//! 主窗口只在**首次使用引导未看过**时自动打开(见 `apply` 末尾);其余情况都不自动显示(关闭 = 退到托盘)。
use crate::windowing;
use tauri::AppHandle;

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

/// setup 末尾调用:读设置 -> 执行启动动作;首次使用(未看过引导)时顺带把主窗叫起来。
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
    // 首次使用引导:没看过 `ui.tutorial_seen` 就在**这里**把主窗叫起来。
    // 为什么不在 IPC 命令里建:从输入栏页面 invoke 建窗会把主线程卡死
    // (实测:窗口停在 about:blank、后续 IPC 永不返回),而这条路径与托盘「打开主窗口」同一实现。
    if !tutorial_seen(app) {
        if let Err(e) = open_main_window(app) {
            eprintln!("首次引导打开主窗口失败(下次启动会再试):{e}");
        }
    }
}

/// 引导标记:只有 "1" 算看过(空串/缺失/读不到都算没看过),与前端 isSeen 同一口径。
fn tutorial_seen(app: &AppHandle) -> bool {
    seen_from_setting(windowing::input_geom::get_str(app, "ui.tutorial_seen").as_deref())
}

/// 纯函数部分(可单测):空串 = 未看过,让「清标记重看」不必删行
pub fn seen_from_setting(raw: Option<&str>) -> bool {
    raw == Some("1")
}

/// 显示主窗口(托盘「打开主窗口」/「设置」共用):窗口存在则只显示,不存在才按需构建
/// (见 windowing::main_window;冷启动时主窗 webview 不创建)
pub fn open_main_window(app: &AppHandle) -> tauri::Result<()> {
    windowing::main_window::open(app)
}

/// 显示主窗口并切到设置页。事件名与前端 use-open-settings.ts 的 OPEN_SETTINGS_EVENT 一致;
/// 新建窗口与已存在窗口两条通道都留 pending(事件可能落在订阅之前),见 main_window::open_settings。
pub fn open_settings_window(app: &AppHandle) -> tauri::Result<()> {
    windowing::main_window::open_settings(app)
}

#[cfg(test)]
#[path = "startup_tests.rs"]
mod startup_tests;
