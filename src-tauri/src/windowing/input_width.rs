//! 输入栏**宽度**单位:逻辑宽 -> 落窗口物理宽的钳制与换算。
//! 从 input_scale 拆出以守 200 行上限(与 input_height 对称:一个文件管一个单位)。
//!
//! 单位约定:宽度入参是**当前逻辑像素**(拖动意图区间 240-900;基线落在区间外时把区间向外抬到
//! 基线,见 clamp_width_from)。设置里的 input_w 存**基础物理尺寸**(缩放系数为 1 时的物理尺寸),
//! 显示时按 input_zoom 乘开后落窗口 —— 宽度是唯一会被拖动路径写回的几何项(见 input_scale::apply_size)。

use tauri::WebviewWindow;

pub const MIN_WIDTH: u32 = 240;
pub const MAX_WIDTH: u32 = 900;

/// 缩放后的窗口不得超出当前显示器工作区的这个比例(宽度与高度共用)
pub(super) const WORK_AREA_RATIO: f64 = 0.8;

/// 宽度钳制(逻辑像素):240-900。
pub fn clamp_width(w: u32) -> u32 {
    w.clamp(MIN_WIDTH, MAX_WIDTH)
}

/// 拖动意图的宽度钳制:**基线**(拖动开始那一刻的逻辑宽)在 240-900 之外时,把区间向外抬到
/// 基线,保证拖动连续。
/// 基线之所以能在区间外:缩放路径只按工作区 80% 收口、不套 240-900(见 input_scale::apply_scale),
/// 于是放大后逻辑宽会超过 MAX_WIDTH、缩小后会低于 MIN_WIDTH ——
/// 2026-10-14 装机版实测:zoom 2.0、input_w 1100 落到 1536 物理像素(工作区 80%)= 1228 逻辑宽,
/// 此时左边缘只需拖进 8 步共 20 物理像素,用硬区间钳制就会把宽度从 1536 跳到 1125 物理像素
/// (左边缘瞬移 411 物理像素),用户看到的是"宽度又跳了"。
/// 抬区间后:基线在区间外时只能朝区间内连续移动(往外拖不动),一旦进入 240-900,硬区间照常生效。
/// 前端 input-geometry.clampWidthFrom 是同一条规则;两边必须一致,否则前端算出的连续意图
/// 会被这里再次钳成跳变。
pub fn clamp_width_from(base_logical: f64, w: u32) -> u32 {
    let b = if base_logical.is_finite() { base_logical.round().max(0.0) as u32 } else { MIN_WIDTH };
    if (MIN_WIDTH..=MAX_WIDTH).contains(&b) {
        return clamp_width(w);
    }
    w.clamp(MIN_WIDTH.min(b), MAX_WIDTH.max(b))
}

/// 逻辑宽 -> 落窗口的物理宽(唯一的宽度换算;高度一律走 input_height::height_phys):
/// 「(可选)按拖动意图钳制 -> 物理换算 -> 与当前显示器工作区 80% 取较小者」
/// `intent_base` = 命令宽度是不是「用户拖动意图」:
/// - `Some(基线逻辑宽)`:宽度拖动命令路径(input_scale::apply_size),走 clamp_width_from
///   (基线在 240-900 之外时区间向外抬到基线,拖动才连续);
/// - `None`:缩放路径(input_scale::apply_scale),宽度不受 240-900 约束,只受工作区 80% 上限 ——
///   基宽 >450 放大到 2.0 时若套 900 硬上限,宽度会卡住而字号继续变大,"窗口与字号等比"不成立;
///   下限同理不强制 240(等比缩放允许变小,缩放系数本身已 0.5-2.0)。
///
/// 取不到工作区(无显示器信息)时只做前面的步骤。
pub fn display_width(
    logical_w: u32,
    sf: f64,
    work: Option<(u32, u32)>,
    intent_base: Option<f64>,
) -> u32 {
    let sf = if sf.is_finite() && sf > 0.0 { sf } else { 1.0 };
    let lw = match intent_base {
        Some(base) => clamp_width_from(base, logical_w),
        None => logical_w.max(1),
    };
    let phys = ((lw as f64) * sf).round().max(1.0) as u32;
    match work {
        Some((w, _)) => phys.min(((w as f64) * WORK_AREA_RATIO) as u32),
        None => phys,
    }
}

/// 输入栏当前所在显示器的工作区(物理像素);取不到时 None(不钳制)
pub(super) fn work_area_of(win: &WebviewWindow) -> Option<(u32, u32)> {
    let mon = win.current_monitor().ok()??;
    let area = mon.work_area();
    Some((area.size.width, area.size.height))
}

#[cfg(test)]
#[path = "input_width_tests.rs"]
mod input_width_tests;
