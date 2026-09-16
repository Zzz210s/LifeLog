//! 主窗(窗口标签 main)按需创建:冷启动只建输入栏,主窗 webview 延后到首次真正需要时。
//! 入口只有托盘「打开主窗口」/「设置」。窗口已存在则只显示,不再重复创建。
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

/// 主窗标签(与 tauri.conf.json 迁移前的声明、前端 getCurrentWindow 语义一致)
pub const MAIN_LABEL: &str = "main";
/// 「打开后切到设置页」事件名(与前端 use-open-settings.ts 的 OPEN_SETTINGS_EVENT 同值)
pub const OPEN_SETTINGS_EVENT: &str = "open-settings";

/// 主窗新建时前端还没订阅事件,用这个标志把「切到设置页」的意图留到前端 mount 时取用。
/// 取走即清空:第二次打开主窗不会被再次切走。
static PENDING_OPEN_SETTINGS: AtomicBool = AtomicBool::new(false);

/// 主窗构建参数(必须与迁移前 tauri.conf.json 的 main 声明等价)
pub struct BuildConfig {
    pub title: &'static str,
    pub url: &'static str,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
    pub drag_drop_enabled: bool,
}

pub fn build_config() -> BuildConfig {
    BuildConfig {
        title: "LifeLog",
        url: "index.html",
        width: 1100.0,
        height: 720.0,
        visible: false,
        drag_drop_enabled: false,
    }
}

/// 记下「打开后切到设置页」的意图(窗口不存在时才调用)
pub fn set_pending() {
    PENDING_OPEN_SETTINGS.store(true, Ordering::SeqCst);
}

/// 取走并清空意图(前端 mount 时经 take_pending_open_settings 命令调用)
pub fn take_pending() -> bool {
    PENDING_OPEN_SETTINGS.swap(false, Ordering::SeqCst)
}

/// 只给测试用:清回初始态
#[cfg(test)]
pub fn reset_pending() {
    PENDING_OPEN_SETTINGS.store(false, Ordering::SeqCst);
}

/// 显示主窗:存在则只显示+聚焦,不存在才构建(构建参数见 build_config)。
/// 新建的窗口会把「关闭 = 退到托盘」的行为一起挂上(迁移前挂在 setup 的 events::register)。
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        w.show()?;
        w.set_focus()?;
        return Ok(());
    }
    let c = build_config();
    let mut builder =
        tauri::WebviewWindowBuilder::new(app, MAIN_LABEL, tauri::WebviewUrl::App(c.url.into()))
            .title(c.title)
            .inner_size(c.width, c.height)
            .visible(c.visible);
    if !c.drag_drop_enabled {
        // tauri 2 没有开启式 API:声明里的 dragDropEnabled:false 等价于关掉处理器
        builder = builder.disable_drag_drop_handler();
    }
    let w = builder.build()?;
    attach_close_to_tray(&w);
    w.show()?;
    w.set_focus()?;
    Ok(())
}

/// 带「打开后切到设置页」的意图:窗口新建时置 pending(前端 mount 时取用,事件会丢),
/// 窗口已存在时直接发事件即时生效。
pub fn open_settings(app: &AppHandle) -> tauri::Result<()> {
    let existed = app.get_webview_window(MAIN_LABEL).is_some();
    if !existed {
        set_pending();
    }
    open(app)?;
    if existed {
        let _ = app.emit(OPEN_SETTINGS_EVENT, ());
    }
    Ok(())
}

fn attach_close_to_tray(w: &WebviewWindow) {
    let handle = w.clone();
    w.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = handle.hide(); // 关闭 = 退到托盘
        }
    });
}

#[cfg(test)]
#[path = "main_window_tests.rs"]
mod main_window_tests;
