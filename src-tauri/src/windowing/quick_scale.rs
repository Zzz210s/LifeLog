//! 快捷窗尺寸:宽度钳制、行数到窗口高度的换算、尺寸应用(含落库)。
//! 单位约定:命令与钳制都用**逻辑像素**(240-900);设置里的 quick_w/quick_h 存**物理**尺寸,
//! 与 quick::show()/hide() 既有语义(读/写 PhysicalSize)保持一致。

use tauri::{AppHandle, Manager, PhysicalSize};

pub const MIN_WIDTH: u32 = 240;
pub const MAX_WIDTH: u32 = 900;

/// 宽度钳制(逻辑像素):240-900。
pub fn clamp_width(w: u32) -> u32 {
    w.clamp(MIN_WIDTH, MAX_WIDTH)
}

/// 行数(钳到 1-5)对应的窗口高度 = 行数 x 行高 + 2 x pad(光晕内边距),四舍五入取整。
/// 高度由前端按真实换行测量后经 set_quick_size 传入,此公式是两端共享的契约,故仅测试使用。
#[cfg(test)]
pub fn window_height_for_lines(lines: u32, line_height: f64, pad: f64) -> u32 {
    let lines = lines.clamp(1, 5) as f64;
    (lines * line_height + 2.0 * pad).round().max(1.0) as u32
}

/// 把逻辑尺寸落到窗口上,并把实际**物理**尺寸写入设置(重启后 show() 直接按物理尺寸还原)。
pub fn apply_size(app: &AppHandle, width: u32, height: u32) -> Result<(), String> {
    let Some(win) = app.get_webview_window("quick") else {
        return Ok(());
    };
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
