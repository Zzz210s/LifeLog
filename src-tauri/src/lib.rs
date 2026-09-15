use tauri_plugin_global_shortcut::GlobalShortcutExt;

mod commands;
mod db;
mod exchange;
mod startup_report;
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
            commands::backup_notice::take_backup_warning,
            commands::notes::save_input_note,
            commands::notes::query_notes,
            commands::notes::update_note,
            commands::notes::toggle_todo,
            commands::notes::delete_note,
            commands::exchange::export_notes,
            commands::tags::list_tags,
            commands::tags::rename_tag,
            commands::tags::move_tag,
            commands::tags::delete_tag,
            commands::tags::tag_impact,
            commands::tags::complete_tags,
            commands::views::list_views,
            commands::views::create_view,
            commands::views::update_view,
            commands::views::delete_view,
            commands::views::reorder_views,
            commands::views::count_view_hits,
            commands::windowing::hide_input_bar,
            commands::windowing::show_input_bar,
            commands::windowing::set_input_size,
            commands::windowing::set_input_scale,
            commands::windowing::begin_input_drag,
            commands::windowing::end_input_drag,
        ])
        .setup(|app| {
            // identifier 由 app.lifelog 改为 com.lifelog.app 后,数据目录也随之改变:
            // 先把旧数据目录的数据库复制到新目录,再打开新库(只复制不移动,旧目录原样保留
            // 作回退)。失败与数据库初始化失败同等处理 —— 弹中文对话框说明原因并以退出码 1
            // 退出,绝不静默用空库继续(那会让用户以为数据丢了)。
            if let Err(reason) = db::data_dir_migration::migrate_for_app(app.handle()) {
                eprintln!("数据目录迁移失败(应用将以退出码 1 退出): {reason}");
                startup_report::show_failure(
                    app.handle(),
                    "数据目录迁移失败",
                    &db::OpenFailure {
                        reason,
                        backup: None,
                    },
                );
                return Ok(());
            }
            // 数据库初始化失败不能 panic(用户只会看到闪退、拿不到原因):弹中文对话框说明
            // 失败原因与已生成的备份,用户确认后以退出码 1 正常退出;迁移成功但备份失败时
            // 给一个不阻断的警告(应用照常可用)。
            match db::init(app.handle()) {
                Ok(report) => {
                    if let Some(warning) = report.backup_warning {
                        startup_report::show_backup_warning(app.handle(), &warning);
                    }
                }
                Err(failure) => {
                    eprintln!("数据库初始化失败(应用将以退出码 1 退出): {}", failure.reason);
                    if let Some(backup) = &failure.backup {
                        eprintln!("迁移前已生成的备份: {}", backup.display());
                    }
                    startup_report::show_failure(app.handle(), "数据库初始化失败", &failure);
                    return Ok(());
                }
            }
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
