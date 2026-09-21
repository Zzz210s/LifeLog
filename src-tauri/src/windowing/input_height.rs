//! 输入栏高度换算与落窗口(从 input_scale 拆出以守 200 行上限)。
//!
//! 单位约定(**关键**):高度命令的入参是**基础逻辑高度** —— 「缩放系数 = 1 时的逻辑像素」,
//! 页面上就是输入框内容高度加内边距的 CSS 像素值(缩放 1 时逻辑像素 == CSS 像素)。
//!
//! 为什么不用「当前逻辑高度」:webview 缩放会同时改变窗口尺寸,而「缩放写库」与「窗口几何读数」
//! 分属两条异步链路。2026-09-21 实测复现:滚轮缩放与内容变化压进同一个任务时,
//! 旧的 `按意图换算 = 意图 x sf / 缩放` 会把派生值固化进设置(zoom 1.10 时 input_w 343 -> 311,
//! 反向也一样会膨胀)。改成缩放无关的入参后,缩放只乘在**落到窗口的物理尺寸**上,
//! 库里永远是基础物理尺寸 —— 缩放派生值一律不落库(项目纪律 #90)。
//!
//! 拆分原因:几何换算与窗口写入都在 input_scale/input_height 两个文件里,各自守住 200 行上限。

use super::input_geom;
use super::input_overlay;
use super::input_scale::{clamp_height, clamp_scale, work_area_of, WORK_AREA_RATIO};
use tauri::{AppHandle, Manager, PhysicalSize, WebviewWindow};

/// 缩放系数兜底:非有限值/非正数按 1.0(与 input_scale::display_size 同一处理)
fn sane_sf(sf: f64) -> f64 {
    if sf.is_finite() && sf > 0.0 {
        sf
    } else {
        1.0
    }
}

/// 当前生效的缩放系数(设置缺失或被手改坏时回退 1.0,并收敛到 0.5-2.0)
pub fn current_zoom(app: &AppHandle) -> f64 {
    clamp_scale(input_geom::get_num(app, "input_zoom").unwrap_or(1.0))
}

/// 基础逻辑高度 -> **基础物理高度**(不落缩放):库里 input_h 的唯一换算。
/// 结构上就拿不到缩放值,故「读缩放与写库交错」这条竞态不可能再影响库值。
pub fn base_h_phys(base_logical_h: u32, sf: f64) -> u32 {
    ((clamp_height(base_logical_h) as f64) * sane_sf(sf))
        .round()
        .max(1.0) as u32
}

/// 基础逻辑高度 -> **落窗口的物理高度**:先按 35-560 兜底,再乘 sf 与缩放,
/// 最后与工作区 80% 收口(与宽度同一收口比例;取不到工作区时不收口)。
pub fn height_phys(base_logical_h: u32, sf: f64, zoom: f64, work_h: Option<u32>) -> u32 {
    let h = clamp_height(base_logical_h) as f64;
    let phys = (h * sane_sf(sf) * clamp_scale(zoom)).round().max(1.0) as u32;
    match work_h {
        Some(wh) => phys.min(((wh as f64) * WORK_AREA_RATIO) as u32),
        None => phys,
    }
}

/// 只改高度、宽度原样保留(取窗口当前物理宽度)。返回落到的物理尺寸。
fn resize_height(
    win: &WebviewWindow,
    base_logical_h: u32,
    sf: f64,
    zoom: f64,
) -> Result<(u32, u32), String> {
    let phys_h = height_phys(base_logical_h, sf, zoom, work_area_of(win).map(|a| a.1));
    let phys_w = win.inner_size().map(|s| s.width).unwrap_or(1).max(1);
    win.set_size(PhysicalSize::new(phys_w, phys_h))
        .map_err(|e| e.to_string())?;
    Ok((phys_w, phys_h))
}

/// 自动高度(内容行数派生):改窗口高度并把**基础**高度写回 input_h。
/// **绝不写 input_w** —— 这条路径并不掌握宽度意图,它只知道"窗口现在多宽";
/// 把窗口几何当意图写回就会在缩放交错时改写用户的基础宽度(实测 343 -> 311)。
pub fn apply_height(app: &AppHandle, base_logical_h: u32) -> Result<(), String> {
    let Some(win) = app.get_webview_window("input") else {
        return Ok(());
    };
    let sf = win.scale_factor().unwrap_or(1.0);
    input_overlay::restore(&win); // 列表关闭时先还原"为列表让位"的临时位移
    resize_height(&win, base_logical_h, sf, current_zoom(app))?;
    input_geom::set(app, "input_h", &base_h_phys(base_logical_h, sf).to_string());
    Ok(())
}

/// 同上但**不写库**:专给「# 补全建议列表展开」的临时高度(带着展开的列表退出应用时,
/// 展开高度会被当成基础尺寸写进 input_h,下次启动就是一条悬空的空高条),并做让位位移。
pub fn apply_height_overlay(app: &AppHandle, base_logical_h: u32) -> Result<(), String> {
    let Some(win) = app.get_webview_window("input") else {
        return Ok(());
    };
    let sf = win.scale_factor().unwrap_or(1.0);
    let phys = resize_height(&win, base_logical_h, sf, current_zoom(app))?;
    input_overlay::shift_for_overlay(&win, phys);
    Ok(())
}

#[cfg(test)]
#[path = "input_height_tests.rs"]
mod input_height_tests;
