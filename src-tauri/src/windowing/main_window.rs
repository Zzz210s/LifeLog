//! 主窗(窗口标签 main)按需创建:冷启动只建输入栏,主窗 webview 延后到首次真正需要时。
//! 入口只有托盘「打开主窗口」/「设置」。窗口已存在则只显示,不再重复创建。
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

use super::main_window_alive as alive;

/// 主窗标签(与 tauri.conf.json 迁移前的声明、前端 getCurrentWindow 语义一致)
pub const MAIN_LABEL: &str = "main";
/// 「打开后切到设置页」事件名(与前端 use-open-settings.ts 的 OPEN_SETTINGS_EVENT 同值)
pub const OPEN_SETTINGS_EVENT: &str = "open-settings";
/// 主窗失焦事件名(与前端 use-leave-save.ts 同值):前端据此执行"离开编辑区块即保存"
pub const BLUR_SAVE_EVENT: &str = "main-window-blur";

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
        title: "拾枝",
        url: "index.html",
        width: 1100.0,
        height: 720.0,
        visible: false,
        drag_drop_enabled: false,
    }
}

/// 记下「打开后切到设置页」的意图(取走即清空;前端 mount 与事件处理各消费一次)
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
///
/// **陈旧句柄自愈**(待办 #36):页面里 `window.close()` 会绕过 CloseRequested 销毁 webview,
/// 而句柄仍在 —— 此时 show()/set_focus() 都是空操作、返回 Ok,窗口再也唤不回来。
/// 所以拿到既有句柄时先做一次活性探针(注入脚本 + 等页面回执),无响应就销毁重建。
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        w.show()?;
        w.set_focus()?;
        let now = Instant::now();
        if alive::should_probe(now, alive::last_build()) {
            alive::schedule(app.clone(), MAIN_LABEL, build_and_show);
        }
        return Ok(());
    }
    build_and_show(app)
}

/// 建窗 + 挂事件 + 显示聚焦(首次创建与陈旧句柄重建**共用同一条路径**,避免两套行为漂移)
fn build_and_show(app: &AppHandle) -> tauri::Result<()> {
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
    attach_blur_save(&w);
    alive::note_built(Instant::now());
    w.show()?;
    w.set_focus()?;
    Ok(())
}

/// 隐藏主窗(与标题栏 X、托盘同一语义)。页面发起的 `window.close()` 已由前端守卫改走这里,
/// 这样 webview 不会被销毁(待办 #36)—— 保持「关闭 = 退到托盘,不丢页面状态」。
pub fn hide(app: &AppHandle) -> tauri::Result<()> {
    match app.get_webview_window(MAIN_LABEL) {
        Some(w) => w.hide(),
        None => Ok(()),
    }
}

/// 「切到设置页」意图的两条投递通道(纯决策,便于单测):返回 (置 pending, 发事件)。
/// - 窗口本次新建:页面还没订阅,事件必然丢 -> 只留 pending(前端 mount 时取用);
/// - 窗口已存在:「存在」不等于「已订阅」(刚建窗/正在重载的页面),emit 可能落在监听注册
///   之前 -> 两条都发:事件即时切页,pending 兜底,由**事件处理时**也消费一次
///   (见前端 use-open-settings.ts)。既补上丢事件,又不会把残留留给下一次普通「打开主窗口」。
fn intent_channels(existed: bool) -> (bool, bool) {
    (true, existed)
}

/// 带「打开后切到设置页」的意图。**先置 pending 再建窗**:新建通道只有 pending 一条路,
/// 若先 open()(内部 build->show->set_focus)再置位,页面可能在置位前就 mount 完并取用,
/// 取到 false 就静默停在信息流(2026-09-21 复审 Important 1);open 失败时把 pending 收回,
/// 免得残留意图把下一次普通「打开主窗口」误切到设置页(回看 I4 / M1)。
pub fn open_settings(app: &AppHandle) -> tauri::Result<()> {
    let (pending, emit) = intent_channels(app.get_webview_window(MAIN_LABEL).is_some());
    if pending {
        set_pending();
    }
    if let Err(e) = open(app) {
        if pending {
            take_pending();
        }
        return Err(e);
    }
    if emit {
        let _ = app.emit(OPEN_SETTINGS_EVENT, ());
    }
    Ok(())
}

/// 主窗失焦 -> 通知前端「离开编辑区块即保存」(用户 2026-09-21 要求:鼠标点出程序页面也保存)。
/// 为什么不用 DOM 的 window blur:WebView2 在宿主窗口失活时不保证派发,而宿主窗口的
/// Focused(false) 是可靠信号(输入栏的失焦隐藏早就用它);前端两条通道都监听,
/// 先到的那次发起保存、后到的那次被 in-flight 守卫挡下,不会重复写库。
fn attach_blur_save(w: &WebviewWindow) {
    let handle = w.clone();
    w.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            // 隐藏(退到托盘)也会失焦:此时同样应该把未保存的编辑落库,故不额外判可见性
            let _ = handle.emit(BLUR_SAVE_EVENT, ());
        }
    });
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
