use crate::windowing;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

pub fn create(app: &tauri::App) -> tauri::Result<()> {
    let open_input = MenuItem::with_id(app, "open-input", "打开输入栏", true, None::<&str>)?;
    let open_main = MenuItem::with_id(app, "open-main", "打开主窗口", true, None::<&str>)?;
    let open_settings = MenuItem::with_id(app, "open-settings", "设置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_input, &open_main, &open_settings, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("默认窗口图标缺失:请先运行 tauri icon");
    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open-input" => {
                let _ = windowing::input::toggle(app);
            }
            "open-main" => {
                let _ = windowing::startup::open_main_window(app);
            }
            "open-settings" => {
                let _ = windowing::startup::open_settings_window(app);
            }
            // 退出前把输入栏位置与视图状态落库(见 events::quit)
            "quit" => windowing::events::quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 左键固定唤起输入栏(不做开关,spec 3.1)
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let _ = windowing::input::toggle(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
