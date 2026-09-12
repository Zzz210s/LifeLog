//! 快捷窗尺寸:宽度/高度钳制与尺寸应用(含落库)。
//! 单位约定:命令与钳制都用**逻辑像素**(宽度 240-900、高度 35-320);设置里的 quick_w/quick_h
//! 存**物理**尺寸,与 quick::show()/hide() 既有语义(读/写 PhysicalSize)保持一致。

use tauri::{AppHandle, Manager, PhysicalSize};

pub const MIN_WIDTH: u32 = 240;
pub const MAX_WIDTH: u32 = 900;

/// 高度区间(逻辑像素),与前端 windowHeightFor 同源推导:
/// 单行 CSS 高度 = 22.75(text-sm + leading-relaxed)+ 上下内边距与边框 18 + 光晕内边距 2 x 14
/// = 68.75;5 行为 159.75。webview 缩放(0.5-2.0)让整体同比放大,故
/// 下界 = ceil(68.75 x 0.5) = 35,上界 = ceil(159.75 x 2.0) = 320。
/// 区间取全部合法缩放的并集:兜底拦下 0 与异常大的值,不误伤任何合法高度。
pub const MIN_HEIGHT: u32 = 35;
pub const MAX_HEIGHT: u32 = 320;

/// 宽度钳制(逻辑像素):240-900。
pub fn clamp_width(w: u32) -> u32 {
    w.clamp(MIN_WIDTH, MAX_WIDTH)
}

/// 高度钳制(逻辑像素):35-320。高度由前端按真实换行测量后传入,此处只做兜底。
pub fn clamp_height(h: u32) -> u32 {
    h.clamp(MIN_HEIGHT, MAX_HEIGHT)
}

/// 把逻辑尺寸落到窗口上,并把实际**物理**尺寸写入设置(重启后 show() 直接按物理尺寸还原)。
pub fn apply_size(app: &AppHandle, width: u32, height: u32) -> Result<(), String> {
    let Some(win) = app.get_webview_window("quick") else {
        return Ok(());
    };
    let height = clamp_height(height);
    let scale = win.scale_factor().unwrap_or(1.0);
    let phys_w = ((width as f64) * scale).round().max(1.0) as u32;
    let phys_h = ((height as f64) * scale).round().max(1.0) as u32;
    win.set_size(PhysicalSize::new(phys_w, phys_h))
        .map_err(|e| e.to_string())?;
    set_setting(app, "quick_w", &phys_w.to_string());
    set_setting(app, "quick_h", &phys_h.to_string());
    Ok(())
}

fn set_setting(app: &AppHandle, key: &str, value: &str) {
    if let Some(db) = app.try_state::<crate::db::Db>() {
        if let Ok(conn) = db.0.lock() {
            let _ = crate::db::repos::settings::set(&conn, key, value);
        }
    }
}

#[cfg(test)]
#[path = "quick_scale_tests.rs"]
mod quick_scale_tests;
