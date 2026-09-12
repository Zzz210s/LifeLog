use tauri::Manager;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

mod commands;
mod db;
mod exchange;
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::set_quick_locks,
            commands::app_info::get_db_info,
            commands::notes::save_quick_note,
            commands::notes::query_notes,
            commands::notes::tag_counts,
            commands::notes::update_note,
            commands::notes::toggle_todo,
            commands::notes::delete_note,
            commands::exchange::export_notes,
            commands::windowing::hide_quick_window,
            commands::windowing::set_quick_size,
            commands::windowing::set_quick_scale,
            commands::windowing::begin_quick_drag,
            commands::windowing::end_quick_drag,
        ])
        .setup(|app| {
            db::init(app.handle())?;
            // 旧几何键语义(含缩放的尺寸)一次性迁移到新语义(基础物理尺寸),单事务幂等
            windowing::quick_geom::migrate_geometry(app.handle());
            windowing::tray::create(app)?;
            windowing::events::register(app)?;
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            let _ = windowing::quick::toggle(app);
                        }
                    })
                    .build(),
            )?;
            // 热键注册失败(如被其他应用占用)不阻断启动,快捷窗仍可从托盘唤起
            if let Err(e) = app.global_shortcut().register("ctrl+shift+q") {
                eprintln!("全局热键注册失败,快捷窗仍可从托盘唤起:{e}");
            }
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
