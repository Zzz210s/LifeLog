use crate::windowing;
use tauri::{AppHandle, Manager, WindowEvent};

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
    if let Some(quick) = app.get_webview_window("quick") {
        quick.on_window_event(move |event| {
            if let WindowEvent::Focused(false) = event {
                // 拖动中跳过失焦隐藏:系统移动循环会给窗口发 Focused(false),
                // 若照常隐藏,窗口会拖到一半就消失(而且 hide() 会把拖动前的旧坐标写进记忆位置)。
                if !windowing::quick::drag_session_active()
                    && windowing::quick::blur_hide_enabled(&handle)
                {
                    let _ = windowing::quick::hide(&handle);
                }
            }
            // 拖动中持续落库位置:模态移动循环里 mouseup 到不了页面(实测 up=0),
            // 位置只能在移动过程中写 —— 最后一个 Moved 就是最终位置。
            if let WindowEvent::Moved(_) = event {
                windowing::quick::commit_position(&handle);
                if windowing::quick::drag_session_active() {
                    windowing::quick::touch_drag_session();
                }
            }
        });
    }
    Ok(())
}
