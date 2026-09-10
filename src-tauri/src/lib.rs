use tauri::Manager;

mod commands;
mod db;
mod tags;
mod windowing;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 二次启动:唤起快捷窗
            let _ = windowing::quick::toggle(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::notes::save_quick_note,
            commands::notes::list_recent_notes,
            commands::windowing::hide_quick_window,
            commands::windowing::toggle_quick_pin,
            commands::windowing::set_quick_zoom,
        ])
        .setup(|app| {
            db::init(app.handle())?;
            windowing::tray::create(app)?;
            windowing::events::register(app)?;
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts(["ctrl+shift+q"])?
                    .with_handler(|app, _shortcut, event| {
                        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            let _ = windowing::quick::toggle(app);
                        }
                    })
                    .build(),
            )?;
            // 手动启动(无 --minimized)时显示主窗口;自启静默进托盘
            if !std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    w.show()?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
