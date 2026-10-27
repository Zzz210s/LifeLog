//! 输入栏窗口(标签 input)按需创建:与主窗(windowing/main_window)同构 —— 冷启动不再声明窗口,
//! 首次唤起才建(热键/托盘/二次启动/启动显示「输入栏」/页面 IPC),「仅托盘」启动时一个 webview 都不建。
//!
//! **唯一入口**:建窗只经 [`ensure`](存在就取、不存在才建),只读路径一律走 [`get`](拿不到就空转),
//! 全仓不再有第二处 `get_webview_window("input")`，也没有第二份窗口属性/标签字符串。
//! 迁移前挂在 setup 的事件(失焦自动隐藏、拖动中落库位置)随建窗一并挂上(见 `attach_events`)。
use super::input;
use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};

/// 输入栏标签(与迁移前 tauri.conf.json 的声明、前端 getCurrentWindow 语义一致)
pub const INPUT_LABEL: &str = "input";

/// 输入栏构建参数(必须与迁移前 tauri.conf.json 的 input 声明等价)
pub struct BuildConfig {
    pub title: &'static str,
    pub url: &'static str,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
    pub decorations: bool,
    pub skip_taskbar: bool,
    pub always_on_top: bool,
    pub resizable: bool,
    pub transparent: bool,
    pub shadow: bool,
}

pub fn build_config() -> BuildConfig {
    BuildConfig {
        title: "输入栏",
        url: "input.html",
        width: 420.0,
        height: 300.0,
        visible: false,
        decorations: false,
        skip_taskbar: true,
        always_on_top: true,
        resizable: false,
        transparent: true,
        shadow: false,
    }
}

/// 只取不建:窗口尚未创建时返回 None,调用方安全空转
/// (迁移前「窗口不存在就什么也不做」的语义:位置落库、尺寸/缩放、隐藏、聚焦都照旧什么都不做)
pub fn get(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(INPUT_LABEL)
}

/// 建窗入口(存在就取,不存在才建):
/// - **只建一次**:建好的窗口 `get` 必然命中,后续唤起不再走 build。建窗请求最终都串到主线程的
///   窗口注册表上 —— 热键/托盘/二次启动/setup 启动动作本就在主线程,主窗的 `show_input_bar`
///   是 async 命令(在异步线程上走「投给主线程 + 等回执」);同一时刻的双建会被注册表挡下,
///   后者拿到 Err 而不会出现两个窗口(窗口已由前一次建好并显示)。
/// - 构建失败直接返回 Err —— 不留半成品窗口,下一次唤起会重试(调用方按各自既有方式记日志)。
/// - 可见性由调用方(show)决定:建窗时沿用声明的 `visible: false`,免得半成品先露出来。
pub fn ensure(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = get(app) {
        return Ok(w);
    }
    let c = build_config();
    let builder = tauri::WebviewWindowBuilder::new(app, INPUT_LABEL, tauri::WebviewUrl::App(c.url.into()))
        .title(c.title)
        .inner_size(c.width, c.height)
        .visible(c.visible);
    // 无边框 / 不占任务栏 / 置顶 / 阴影都是桌面窗口管理器的概念(安卓 P0 起 gated)
    #[cfg(feature = "desktop")]
    let builder = builder
        .decorations(c.decorations)
        .skip_taskbar(c.skip_taskbar)
        .always_on_top(c.always_on_top)
        .resizable(c.resizable)
        .transparent(c.transparent)
        .shadow(c.shadow);
    let built = builder.build()?;
    attach_events(&built);
    Ok(built)
}

/// 迁移前 `events::register` 挂在声明窗口上的两个事件,现在随建窗挂上:
/// - 失焦 -> 「失焦自动隐藏」时隐藏(拖动会话中跳过,见 input::hide 上方注释);
/// - 移动 -> 拖动中持续落库位置(模态移动循环里 mouseup 到不了页面)。
fn attach_events(w: &WebviewWindow) {
    let handle = w.app_handle().clone();
    w.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            if !input::drag_session_active() && input::blur_hide_enabled(&handle) {
                let _ = input::hide(&handle);
            }
        }
        if let WindowEvent::Moved(_) = event {
            input::commit_position(&handle);
            if input::drag_session_active() {
                input::touch_drag_session();
            }
        }
    });
}

#[cfg(test)]
#[path = "input_window_tests.rs"]
mod input_window_tests;
