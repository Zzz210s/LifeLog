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
            // 只显示/置前,不做切换:启动后输入栏默认就是可见的,若用 toggle 则点「打开输入栏」
            // 反而会把它藏起来(与菜单文案相反),也与左键行为完全重复
            "open-input" => {
                let _ = windowing::input::show(app);
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
            // 左键打开主窗口(与菜单项「打开主窗口」同一实现,spec 2026-09-17 S1);
            // 输入栏不再由托盘左键唤起,仍由热键/菜单项/二次启动唤起。
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let _ = windowing::startup::open_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
