use crate::db::repos;
use crate::db::Db;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

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
        if let (Some(wv), Some(hv)) = (get_setting(app, "quick_w"), get_setting(app, "quick_h")) {
            if let (Ok(wv), Ok(hv)) = (wv.parse::<u32>(), hv.parse::<u32>()) {
                let _ = w.set_size(PhysicalSize::new(wv, hv));
            }
        }
        if let Some(z) = get_setting(app, "quick_zoom").and_then(|s| s.parse::<f64>().ok()) {
            let _ = w.set_zoom(z);
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
            set_setting(app, "quick_w", &s.width.to_string());
            set_setting(app, "quick_h", &s.height.to_string());
        }
        w.hide()?;
    }
    Ok(())
}

/// 失焦是否自动隐藏(默认 true)
pub fn blur_hide_enabled(app: &AppHandle) -> bool {
    get_setting(app, "quick_hide_on_blur").map(|v| v != "false").unwrap_or(true)
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
