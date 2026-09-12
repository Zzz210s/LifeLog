use crate::db::repos;
use crate::db::Db;
use crate::windowing::quick_scale;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

fn get_setting(app: &AppHandle, key: &str) -> Option<String> {
    let db: tauri::State<Db> = app.state();
    let conn = db.0.lock().ok()?;
    repos::settings::get(&conn, key).ok().flatten()
}

fn set_setting(app: &AppHandle, key: &str, value: &str) {
    if let Some(db) = app.try_state::<Db>() {
        if let Ok(conn) = db.0.lock() {
            let _ = repos::settings::set(&conn, key, value);
        }
    }
}

fn win(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("quick")
}

pub fn toggle(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = win(app) {
        if w.is_visible().unwrap_or(false) {
            hide(app)
        } else {
            show(app)
        }
    } else {
        Ok(())
    }
}

pub fn show(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = win(app) {
        // 恢复记忆的几何
        if let (Some(x), Some(y)) = (get_setting(app, "quick_x"), get_setting(app, "quick_y")) {
            if let (Ok(x), Ok(y)) = (x.parse::<i32>(), y.parse::<i32>()) {
                let _ = w.set_position(PhysicalPosition::new(x, y));
            }
        }
        // 尺寸 = 基础尺寸(quick_w/quick_h)x 缩放系数,再由工作区收口;缩放同时落到 webview zoom。
        // 读回值可能被手改成 NaN/越界,clamp_scale 收敛到 0.5-2.0(非有限值回退 1.0)。
        let zoom = get_setting(app, "quick_zoom")
            .and_then(|s| s.parse::<f64>().ok())
            .map(quick_scale::clamp_scale)
            .unwrap_or(1.0);
        let _ = quick_scale::apply_scale(app, zoom);
        // 恢复记忆的置顶状态(默认 true);隐藏窗口上设置亦安全,须在 show 前
        let pin = get_setting(app, "quick_always_on_top")
            .map(|v| v != "false")
            .unwrap_or(true);
        let _ = w.set_always_on_top(pin);
        // 窗口实际已隐藏而 tao 缓存认为仍可见时(例如被外部 ShowWindow(SW_HIDE) 隐藏过),
        // show() 的 flags diff 为空会静默早退、窗口唤不出来。系统未可见时先 hide() 对齐缓存,
        // 再 show();两边一致时这步是空操作。
        if !w.is_visible().unwrap_or(true) {
            let _ = w.hide(); // 尽力而为:对齐失败也要继续走主操作 show()
        }
        w.show()?;
        w.set_focus()?;
    }
    Ok(())
}

pub fn hide(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = win(app) {
        if let Ok(p) = w.outer_position() {
            set_setting(app, "quick_x", &p.x.to_string());
            set_setting(app, "quick_y", &p.y.to_string());
        }
        if let Ok(s) = w.outer_size() {
            // 写回的是基础尺寸:当前窗口已含缩放,除回系数(缩放系数不回退,下次 show 仍按它放大)
            let zoom = get_setting(app, "quick_zoom")
                .and_then(|v| v.parse::<f64>().ok())
                .map(quick_scale::clamp_scale)
                .unwrap_or(1.0);
            let (bw, bh) = quick_scale::base_size_from_actual(s.width, s.height, zoom);
            set_setting(app, "quick_w", &bw.to_string());
            set_setting(app, "quick_h", &bh.to_string());
        }
        // 窗口实际可见而 tao 缓存认为已隐藏时(例如被外部 ShowWindow / SetWindowPos
        // (SWP_SHOWWINDOW) 显示过,或由系统恢复),hide() 的 flags diff 为空会静默早退
        // (返回 Ok 但窗口留在屏幕上)。先 show() 让缓存对齐,再 hide() 才真正执行 SW_HIDE;
        // 窗口本来就隐藏时跳过 show(),避免闪现。
        if w.is_visible().unwrap_or(false) {
            let _ = w.show(); // 尽力而为:对齐失败也要继续走主操作 hide()
        }
        w.hide()?;
    }
    Ok(())
}

/// 失焦是否自动隐藏(贴纸模式:默认不隐藏,仅显式设 "true" 才隐藏)
pub fn blur_hide_enabled(app: &AppHandle) -> bool {
    get_setting(app, "quick_hide_on_blur").map(|v| v == "true").unwrap_or(false)
}

pub fn set_zoom(app: &AppHandle, zoom: f32) -> Result<(), String> {
    let z = (zoom as f64).clamp(0.5, 2.0);
    if let Some(w) = win(app) {
        w.set_zoom(z).map_err(|e| e.to_string())?;
    }
    set_setting(app, "quick_zoom", &format!("{z:.2}"));
    Ok(())
}

pub fn toggle_pin(app: &AppHandle) -> Result<bool, String> {
    let cur = get_setting(app, "quick_always_on_top").unwrap_or_else(|| "true".into());
    let next = cur != "true";
    if let Some(w) = win(app) {
        w.set_always_on_top(next).map_err(|e| e.to_string())?;
    }
    set_setting(app, "quick_always_on_top", if next { "true" } else { "false" });
    Ok(next)
}
