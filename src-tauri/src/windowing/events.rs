use crate::windowing;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// 退出前广播给各 webview 的落盘事件(前端订阅点 `usePaletteSettings` 的 APP_QUITTING_EVENT,
/// 两处字符串必须一致)。退出路径是 `AppHandle::exit(0)`,webview 不做正常卸载、`beforeunload`
/// 不触发,停在内存里的 MRU 会丢最后一次接受;故在 exit 前广播一次,给页面写库的机会。
const APP_QUITTING_EVENT: &str = "app-quitting";

/// 退出前的宽限:既给 `input::hide()` 后的页面结算(透明度/缩放),也给 `app-quitting`
/// 订阅者的 MRU 落盘(均为 IPC,实测远小于该值)。sleep 放在后台线程,不阻塞事件循环,
/// 事件循环才能在这段窗口里处理页面发来的写库请求;exit 自身向事件循环投递消息,可从任意线程调用。
/// 残留风险:宽限期是经验值,极端情况下页面仍可能未写完。
const QUIT_GRACE_MS: u64 = 300;

/// 退出前把输入栏位置与视图状态落库,
/// 并广播 `app-quitting` 让主窗/输入栏把 MRU 等脏数据立刻写库,再结束进程(托盘「退出」/`quit_app`)。
pub fn quit(app: &AppHandle) {
    // 先广播再隐藏:输入栏隐藏后其页面计时器可能被冻结,先让两窗都收到事件并发出写库 IPC
    let _ = app.emit(APP_QUITTING_EVENT, ());
    let _ = windowing::input::hide(app);
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(QUIT_GRACE_MS));
        handle.exit(0);
    });
}
