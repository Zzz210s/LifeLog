use crate::windowing;
use std::time::Duration;
use tauri::{AppHandle, Manager, WindowEvent};

/// 退出前把输入栏位置与视图状态落库,再结束进程(托盘「退出」)。
/// 复用现有落库入口:`input::hide()` 会写 input_x/input_y,并先发 input-hiding 让页面
/// 立即结算节流中的透明度/缩放(见 InputBar 的 input-hiding 订阅)。页面结算走 IPC,
/// 是异步的;直接 exit 会把在途请求丢掉,故给一小段宽限再退。
/// 宽限期间必须让主线程空闲才能处理页面的写库请求,所以 sleep 放在后台线程,
/// 不阻塞事件循环;exit 自身是向事件循环投递消息,可从任意线程调用。
/// 残留风险:宽限期是经验值(实测 200ms 足够),极端情况下页面仍可能未结算完。
pub fn quit(app: &AppHandle) {
    let _ = windowing::input::hide(app);
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(200));
        handle.exit(0);
    });
}

pub fn register(app: &tauri::App) -> tauri::Result<()> {
    if let Some(main) = app.get_webview_window("main") {
        let w = main.clone();
        main.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = w.hide(); // 关闭 = 退到托盘
            }
        });
    }
    let handle: AppHandle = app.handle().clone();
    if let Some(input) = app.get_webview_window("input") {
        input.on_window_event(move |event| {
            if let WindowEvent::Focused(false) = event {
                // 拖动中跳过失焦隐藏:系统移动循环会给窗口发 Focused(false),
                // 若照常隐藏,窗口会拖到一半就消失(而且 hide() 会把拖动前的旧坐标写进记忆位置)。
                if !windowing::input::drag_session_active()
                    && windowing::input::blur_hide_enabled(&handle)
                {
                    let _ = windowing::input::hide(&handle);
                }
            }
            // 拖动中持续落库位置:模态移动循环里 mouseup 到不了页面(实测 up=0),
            // 位置只能在移动过程中写 —— 最后一个 Moved 就是最终位置。
            if let WindowEvent::Moved(_) = event {
                windowing::input::commit_position(&handle);
                if windowing::input::drag_session_active() {
                    windowing::input::touch_drag_session();
                }
            }
        });
    }
    Ok(())
}
