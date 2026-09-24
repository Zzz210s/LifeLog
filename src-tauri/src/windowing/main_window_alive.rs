//! 主窗 webview 的活性探针与「陈旧句柄」判定(待办 #36)。
//!
//! 为什么需要它:页面里执行 `window.close()` 走 WebView2 自己的关闭流程,绕过 Tauri 的
//! `CloseRequested`(主窗的「关闭 = 退到托盘」就挂在那上面),结果是 webview 被销毁、
//! 而 Tao 窗口的 HWND 与 Tauri 的窗口句柄都还在。此时 `show()` / `set_focus()` 都返回 `Ok`
//! 却是空操作,托盘「打开主窗口」再也唤不回一个可用的窗口(2026-09-23 实测)。
//!
//! 探针为什么不能直接用 `eval()`:实测对已销毁的 webview 也返回 `Ok`(它是单向投递,不等回执),
//! 因此必须**注入脚本 + 等页面回调**才算证明 webview 还能执行脚本。
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use std::time::{Duration, Instant};
use tauri::WebviewWindow;

/// 最近一次收到的回执 token(同一时刻只会有一次探针在飞)
static ACKED: Mutex<Option<String>> = Mutex::new(None);
/// 最近一次构建主窗的时刻:刚建好的窗口还在加载,此时探针大概率等不到回执,不能据此判死
static LAST_BUILD: Mutex<Option<Instant>> = Mutex::new(None);

/// 探针等待预算:健康页面回执通常 1-10ms;预算只影响「陈旧句柄」这一异常路径的耗时
const PROBE_BUDGET: Duration = Duration::from_millis(200);
const PROBE_STEP: Duration = Duration::from_millis(20);
/// 刚建窗后的豁免期:加载中的页面不该被探针判死(dev 冷加载可能数秒)
const BUILD_GRACE: Duration = Duration::from_secs(5);

/// 页面回调入口(命令层调用):记下这次回执的 token
pub fn record_ack(token: &str) {
    if let Ok(mut slot) = ACKED.lock() {
        *slot = Some(token.to_string());
    }
}

/// 记下构建时刻(open() 建窗后调用)
pub fn note_built(now: Instant) {
    if let Ok(mut slot) = LAST_BUILD.lock() {
        *slot = Some(now);
    }
}

/// 最近一次构建时刻(open() 里判定豁免期用)
pub fn last_build() -> Option<Instant> {
    LAST_BUILD.lock().ok().and_then(|slot| *slot)
}

/// 现在是否该做活性探针(纯函数,便于单测):
/// - 从没建过窗(不该走到这里) -> 不探,直接走构建路径;
/// - 刚建窗未满豁免期 -> 不探,加载中的页面不能判死。
pub fn should_probe(now: Instant, last_build: Option<Instant>) -> bool {
    match last_build {
        None => false,
        Some(t) => now.duration_since(t) >= BUILD_GRACE,
    }
}

/// 注入脚本并等页面回执:证明 webview 还能执行脚本。
/// 注入本身失败、或预算内没等到回执 -> 判定该句柄已陈旧(须销毁重建)。
pub fn probe(w: &WebviewWindow) -> bool {
    let token = format!("{}", Instant::now().elapsed().as_nanos() ^ std::process::id() as u128);
    if let Ok(mut slot) = ACKED.lock() {
        *slot = None;
    }
    // 页面侧用 internals 直调命令,避免依赖 @tauri-apps/api 是否已加载
    let js = format!(
        "try{{window.__TAURI_INTERNALS__.invoke('webview_ack',{{token:'{token}'}})}}catch(e){{}}"
    );
    if w.eval(&js).is_err() {
        return false;
    }
    let deadline = Instant::now() + PROBE_BUDGET;
    while Instant::now() < deadline {
        if let Ok(slot) = ACKED.lock() {
            if slot.as_deref() == Some(token.as_str()) {
                return true;
            }
        }
        std::thread::sleep(PROBE_STEP);
    }
    false
}

/// 后台做一次活性探针;判定陈旧就回到主线程销毁并重建。`rebuild` 由调用方传入
/// (`main_window::build_and_show`),避免两个模块互相依赖。
///
/// **为什么必须后台 + 异步**:回执命令 `webview_ack` 要靠主线程事件循环处理,而托盘菜单
/// 处理函数就在主线程上 —— 在主线程里 `sleep` 等回执等于自己把回执堵死,健康窗口也会被判死
/// (2026-09-23 实测:健康窗口被误判 -> 误销毁 -> 重建又撞 label 冲突)。
pub fn schedule(app: AppHandle, label: &'static str, rebuild: fn(&AppHandle) -> tauri::Result<()>) {
    std::thread::spawn(move || {
        let Some(w) = app.get_webview_window(label) else {
            return;
        };
        if probe(&w) {
            return; // 健康:什么都不做
        }
        let a = app.clone();
        let _ = app.run_on_main_thread(move || heal(&a, label, rebuild));
    });
}

/// 销毁陈旧句柄,并在**事件循环跑起来之后**重建:`destroy()` 要等事件循环处理完才真正
/// 从注册表消失,所以这里先销毁立刻返回,由后台线程轮询注册表,消失后再回主线程建窗。
fn heal(app: &AppHandle, label: &'static str, rebuild: fn(&AppHandle) -> tauri::Result<()>) {
    let Some(w) = app.get_webview_window(label) else {
        return;
    };
    eprintln!("主窗 webview 无响应:销毁陈旧句柄并重建");
    let _ = w.destroy();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut gone = false;
        for _ in 0..60 {
            std::thread::sleep(Duration::from_millis(25));
            if app2.get_webview_window(label).is_none() {
                gone = true;
                break;
            }
        }
        if !gone {
            eprintln!("主窗陈旧句柄销毁后仍未从注册表消失,本次不重建");
            return;
        }
        let app3 = app2.clone();
        let _ = app2.run_on_main_thread(move || {
            if let Err(e) = rebuild(&app3) {
                eprintln!("主窗重建失败: {e}");
            }
        });
    });
}

#[cfg(test)]
#[path = "main_window_alive_tests.rs"]
mod main_window_alive_tests;
