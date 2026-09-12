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
            // 二次启动:唤起已运行实例的输入栏。用 show 而非 toggle —— 输入栏在启动时默认
            // 就是可见的,再次双击 exe 若走 toggle 会把用户眼前的输入栏隐藏掉(与 README 相反)。
            // 热键与托盘左键仍是切换语义。
            let _ = windowing::input::show(app);
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
            commands::settings::set_input_locks,
            commands::startup::get_autostart_status,
            commands::startup::set_autostart,
            commands::app_info::get_db_info,
            commands::notes::save_input_note,
            commands::notes::query_notes,
            commands::notes::tag_counts,
            commands::notes::update_note,
            commands::notes::toggle_todo,
            commands::notes::delete_note,
            commands::exchange::export_notes,
            commands::windowing::hide_input_bar,
            commands::windowing::set_input_size,
            commands::windowing::set_input_scale,
            commands::windowing::begin_input_drag,
            commands::windowing::end_input_drag,
        ])
        .setup(|app| {
            db::init(app.handle())?;
            // 旧几何键语义(含缩放的尺寸)一次性迁移到新语义(基础物理尺寸),单事务幂等
            windowing::input_geom::migrate_geometry(app.handle());
            windowing::tray::create(app)?;
            windowing::events::register(app)?;
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            let _ = windowing::input::toggle(app);
                        }
                    })
                    .build(),
            )?;
            // 热键注册失败(如被其他应用占用)不阻断启动,输入栏仍可从托盘唤起
            if let Err(e) = app.global_shortcut().register("ctrl+shift+q") {
                eprintln!("全局热键注册失败,输入栏仍可从托盘唤起:{e}");
            }
            // 启动动作只由设置决定(spec 3.1:手动启动与开机自启一致):
            // 「输入栏」唤起输入栏,「仅托盘」不显示任何窗口。主窗口在任何情况下都不自动显示。
            // 自启插件会带 --minimized,该参数只作为「本次由自启拉起」的事实传入(当前不改变动作)。
            let autostart_launch = std::env::args().any(|a| a == "--minimized");
            windowing::startup::apply(app.handle(), autostart_launch);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
