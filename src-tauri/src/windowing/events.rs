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
                if windowing::quick::blur_hide_enabled(&handle) {
                    let _ = windowing::quick::hide(&handle);
                }
            }
        });
    }
    Ok(())
}
