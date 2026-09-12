//! 快捷窗尺寸与视图缩放:尺寸钳制、缩放换算、落到窗口并落库。
//! 单位约定:命令与钳制都用**逻辑像素**(宽度 240-900、高度 35-320);设置里的 quick_w/quick_h
//! 存**基础物理尺寸**(缩放系数为 1 时的物理尺寸),显示时按 quick_zoom 乘开后落到窗口;
//! 缩放系数存 quick_zoom(0.5-2.0),hide() 只写回基础尺寸,系数不回退。

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

pub const MIN_SCALE: f64 = 0.5;
pub const MAX_SCALE: f64 = 2.0;

/// 缩放后的窗口不得超出当前显示器工作区的这个比例
const WORK_AREA_RATIO: f64 = 0.8;
/// 设置缺失时的基础尺寸(逻辑像素),与 tauri.conf.json 的 quick 窗口默认值一致
const DEFAULT_WIDTH: u32 = 420;
const DEFAULT_HEIGHT: u32 = 300;

/// 宽度钳制(逻辑像素):240-900。
pub fn clamp_width(w: u32) -> u32 {
    w.clamp(MIN_WIDTH, MAX_WIDTH)
}

/// 高度钳制(逻辑像素):35-320。高度由前端按真实换行测量后传入,此处只做兜底。
pub fn clamp_height(h: u32) -> u32 {
    h.clamp(MIN_HEIGHT, MAX_HEIGHT)
}

/// 缩放系数收敛到 0.5-2.0;非有限值(NaN/Infinity,可能被人手改坏)回退 1.0。
pub fn clamp_scale(scale: f64) -> f64 {
    if !scale.is_finite() {
        return 1.0;
    }
    scale.clamp(MIN_SCALE, MAX_SCALE)
}

/// 按系数放大尺寸(四舍五入,最小 1)
pub fn scaled_size(w: u32, h: u32, scale: f64) -> (u32, u32) {
    let f = |v: u32| ((v as f64) * scale).round().max(1.0) as u32;
    (f(w), f(h))
}

/// 与工作区取较小者(上限 = 工作区的 80%,向下取整)
pub fn cap_to_work_area(w: u32, h: u32, work_w: u32, work_h: u32) -> (u32, u32) {
    let cap = |v: u32, area: u32| v.min(((area as f64) * WORK_AREA_RATIO) as u32);
    (cap(w, work_w), cap(h, work_h))
}

/// 由「当前实际尺寸(已含缩放)」反推基础尺寸(最小 1)
pub fn base_size_from_actual(w: u32, h: u32, scale: f64) -> (u32, u32) {
    let s = clamp_scale(scale);
    let f = |v: u32| ((v as f64) / s).round().max(1.0) as u32;
    (f(w), f(h))
}

fn get_setting_num(app: &AppHandle, key: &str) -> Option<f64> {
    let db = app.try_state::<crate::db::Db>()?;
    let conn = db.0.lock().ok()?;
    let raw = crate::db::repos::settings::get(&conn, key).ok().flatten()?;
    raw.trim().parse::<f64>().ok()
}

fn set_setting(app: &AppHandle, key: &str, value: &str) {
    if let Some(db) = app.try_state::<crate::db::Db>() {
        if let Ok(conn) = db.0.lock() {
            let _ = crate::db::repos::settings::set(&conn, key, value);
        }
    }
}

/// 把逻辑尺寸落到窗口上,并把实际**基础**物理尺寸写入设置:
/// 当前窗口已含 webview 缩放,故写回前先除回缩放系数(系数为 1 时与旧行为一致)。
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
    let zoom = clamp_scale(get_setting_num(app, "quick_zoom").unwrap_or(1.0));
    let (base_w, base_h) = base_size_from_actual(phys_w, phys_h, zoom);
    set_setting(app, "quick_w", &base_w.to_string());
    set_setting(app, "quick_h", &base_h.to_string());
    Ok(())
}

/// 按缩放系数设置窗口尺寸与 webview zoom,并把系数写回 quick_zoom。
/// 尺寸 = 基础尺寸(quick_w/quick_h,物理)x 系数;宽度同时守住 240-900 逻辑像素
/// (冲突取较小者),最后与当前显示器工作区的 80% 取较小者(取不到显示器则不钳制)。
pub fn apply_scale(app: &AppHandle, scale: f64) -> Result<(), String> {
    let s = clamp_scale(scale);
    let Some(win) = app.get_webview_window("quick") else {
        set_setting(app, "quick_zoom", &format!("{s:.2}"));
        return Ok(());
    };
    let sf = win.scale_factor().unwrap_or(1.0);
    let base_w = get_setting_num(app, "quick_w").unwrap_or(DEFAULT_WIDTH as f64 * sf);
    let base_h = get_setting_num(app, "quick_h").unwrap_or(DEFAULT_HEIGHT as f64 * sf);
    let (lw, lh) = scaled_size((base_w / sf) as u32, (base_h / sf) as u32, s);
    let lw = clamp_width(lw);
    let mut phys = (
        ((lw as f64) * sf).round().max(1.0) as u32,
        ((lh as f64) * sf).round().max(1.0) as u32,
    );
    if let Ok(Some(mon)) = win.current_monitor() {
        let area = mon.work_area();
        phys = cap_to_work_area(phys.0, phys.1, area.size.width, area.size.height);
    }
    win.set_size(PhysicalSize::new(phys.0, phys.1))
        .map_err(|e| e.to_string())?;
    win.set_zoom(s).map_err(|e| e.to_string())?;
    set_setting(app, "quick_zoom", &format!("{s:.2}"));
    Ok(())
}

#[cfg(test)]
#[path = "quick_scale_tests.rs"]
mod quick_scale_tests;
