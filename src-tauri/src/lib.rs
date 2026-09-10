mod commands;
mod db;
mod tags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            db::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::notes::save_quick_note,
            commands::notes::list_recent_notes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
