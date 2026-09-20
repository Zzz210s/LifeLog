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
            // 反而会把它藏起来(与菜单文案相反),也与左键行为完全重复(见 events::quit)
            // 建窗/显窗是真实 I/O,失败不能吞:至少 eprintln 留痕(2026-09-21 回看 I4/M2)
            "open-input" => {
                if let Err(e) = windowing::input::show(app) {
                    eprintln!("托盘「打开输入栏」失败: {e}");
                }
            }
            "open-main" => {
                if let Err(e) = windowing::startup::open_main_window(app) {
                    eprintln!("托盘「打开主窗口」失败: {e}");
                }
            }
            "open-settings" => {
                if let Err(e) = windowing::startup::open_settings_window(app) {
                    eprintln!("托盘「设置」失败: {e}");
                }
            }
            // 退出前把输入栏位置落库(见 events::quit)
            "quit" => windowing::events::quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 左键打开主窗口(与菜单项「打开主窗口」同一实现,spec 2026-09-17 S1);
            // 输入栏不再由托盘左键唤起,仍由热键/菜单项/二次启动唤起。
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                if let Err(e) = windowing::startup::open_main_window(tray.app_handle()) {
                    eprintln!("托盘左键打开主窗口失败: {e}");
                }
            }
        })
        .build(app)?;
    Ok(())
}
