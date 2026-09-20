//! 输入栏尺寸与视图缩放:尺寸钳制、缩放换算、落到窗口并落库。
//! 单位约定:命令都用**逻辑像素**(高度 35-320);宽度 240-900 是**拖动意图区间**,
//! 只在宽度/自动高度命令路径(apply_size)生效;缩放路径(apply_scale)只受工作区 80% 上限。
//! 设置里的 input_w/input_h 存**基础物理尺寸**(缩放系数为 1 时的物理尺寸),显示时按 input_zoom
//! 乘开后落到窗口;缩放系数存 input_zoom(0.5-2.0)。基础尺寸只由 apply_size 按**命令意图**写回;
//! hide() 只写位置,绝不由窗口实际尺寸反推(会把钳制结果固化)。旧语义(含缩放的尺寸)由
//! input_geom::migrate_geometry 一次性迁移。

use super::input_geom;
use tauri::{AppHandle, Manager, PhysicalSize, WebviewWindow};


pub const MIN_WIDTH: u32 = 240;
pub const MAX_WIDTH: u32 = 900;

/// 高度区间(逻辑像素),与前端 windowHeightFor 同源推导:
/// 单行 CSS 高度 = 22.75(text-sm + leading-relaxed)+ 上下内边距与边框 18 + 光晕内边距 2 x 14
/// = 68.75;5 行为 159.75。webview 缩放(0.5-2.0)让整体同比放大,故
/// 下界 = ceil(68.75 x 0.5) = 35。
/// 上界 = 5 行 @2.0(320)+ # 补全建议列表 8 行 x 24 + 面板内边距 8,按 2.0 放大后约 560 ——
/// 建议列表是窗口内的一部分(像浏览器搜索框下方的推荐列表),故上界要把它算进去。
/// 区间取全部合法缩放的并集:兜底拦下 0 与异常大的值,不误伤任何合法高度。
pub const MIN_HEIGHT: u32 = 35;
pub const MAX_HEIGHT: u32 = 560;

pub const MIN_SCALE: f64 = 0.5;
pub const MAX_SCALE: f64 = 2.0;

/// 缩放后的窗口不得超出当前显示器工作区的这个比例
const WORK_AREA_RATIO: f64 = 0.8;
/// 设置缺失时的基础尺寸(逻辑像素),与 tauri.conf.json 的 input 窗口默认值一致
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

/// 由命令收到的尺寸**意图**(逻辑像素)换算要写回设置的基础物理尺寸:
/// 基础物理 = 逻辑意图 x 系统缩放 / 缩放系数。
/// 只能按意图换算:拿窗口实际尺寸反推会把钳制/工作区收口结果固化成用户几何。
pub fn base_from_intent(logical: u32, sf: f64, scale: f64) -> u32 {
    let s = clamp_scale(scale);
    let sf = if sf.is_finite() && sf > 0.0 { sf } else { 1.0 };
    ((logical as f64) * sf / s).round().max(1.0) as u32
}

/// 宽度意图与当前逻辑宽是否算「真的变了」(容差 0.5 逻辑像素,吸收物理取整抖动)。
/// 自动高度路径每次都带一个宽度,用它挡掉「没拖动也反复改写 input_w」。
pub fn width_intent_changed(current_logical: f64, intent_logical: u32) -> bool {
    (current_logical - intent_logical as f64).abs() > 0.5
}

/// 旧几何 -> 新几何:input_w/input_h 从「含缩放的尺寸」换算成「缩放=1 的基础尺寸」。
/// 与本文件基础的「实际 -> 基础」同一换算,只是输入是设置里的 f64 原始值。
pub fn migrate_size(w: f64, h: f64, scale: f64) -> (u32, u32) {
    let to_u32 = |v: f64| if v.is_finite() { v.round().max(0.0) as u32 } else { 0 };
    base_size_from_actual(to_u32(w), to_u32(h), scale)
}

/// 逻辑尺寸 -> 落到窗口的物理尺寸:依次「(可选)钳宽 240-900 / 钳高 35-320 -> 物理换算 ->
/// 与当前显示器工作区 80% 取较小者」。
/// `clamp_intent` = 是否把宽度当「用户拖动意图」套 240-900:
/// - true:宽度/自动高度命令路径(apply_size),手动拖宽/拖窄的 240-900 区间生效;
/// - false:缩放路径(apply_scale),只受工作区 80% 上限 —— 基宽 >450 放大到 2.0 时若套 900
///   硬上限,宽度会卡住而字号继续变大,"窗口与字号等比"不成立;下限同理不强制 240
///   (等比缩放允许变小,缩放系数本身已限 0.5-2.0)。
/// 高度两条路径都钳 35-320:它由前端按内容行数给出,上限恰好覆盖 5 行 @2.0,兜底不误伤。
/// 取不到工作区(无显示器信息)时只做前面的步骤。
pub fn display_size(
    logical_w: u32,
    logical_h: u32,
    sf: f64,
    work: Option<(u32, u32)>,
    clamp_intent: bool,
) -> (u32, u32) {
    let sf = if sf.is_finite() && sf > 0.0 { sf } else { 1.0 };
    let logical_w = if clamp_intent { clamp_width(logical_w) } else { logical_w.max(1) };
    let phys = (
        ((logical_w as f64) * sf).round().max(1.0) as u32,
        ((clamp_height(logical_h) as f64) * sf).round().max(1.0) as u32,
    );
    match work {
        Some((w, h)) => cap_to_work_area(phys.0, phys.1, w, h),
        None => phys,
    }
}

/// 输入栏当前所在显示器的工作区(物理像素);取不到时 None(不钳制)
fn work_area_of(win: &WebviewWindow) -> Option<(u32, u32)> {
    let mon = win.current_monitor().ok()??;
    let area = mon.work_area();
    Some((area.size.width, area.size.height))
}

/// 把逻辑尺寸落到窗口上,并把**由命令意图换算的基础尺寸**写入设置:
/// 宽度只在真的变化时才写(自动高度路径每次都带一个宽度,不能反复改写用户宽度意图);
/// 高度随内容行数变,每次按意图写回。
pub fn apply_size(app: &AppHandle, width: u32, height: u32) -> Result<(), String> {
    let Some(win) = app.get_webview_window("input") else {
        return Ok(());
    };
    let height = clamp_height(height);
    let sf = win.scale_factor().unwrap_or(1.0);
    // 列表关掉时先还原"为列表让位"的临时位移(见 apply_size_overlay)
    input_overlay::restore(&win);
    // 与缩放路径共用 display_size:宽度命令路径把宽度当拖动意图,套 240-900 后再受工作区 80% 收口。
    // 写回设置用命令意图(base_from_intent),收口结果绝不固化成基础尺寸。
    let phys = display_size(width, height, sf, work_area_of(&win), true);
    let width_changed = win
        .inner_size()
        .map(|s| width_intent_changed(s.to_logical::<f64>(sf).width, width))
        .unwrap_or(false);
    win.set_size(PhysicalSize::new(phys.0, phys.1))
        .map_err(|e| e.to_string())?;
    let zoom = clamp_scale(input_geom::get_num(app, "input_zoom").unwrap_or(1.0));
    if width_changed {
        input_geom::set(app, "input_w", &base_from_intent(width, sf, zoom).to_string());
    }
    input_geom::set(app, "input_h", &base_from_intent(height, sf, zoom).to_string());
    Ok(())
}

/// 按缩放系数设置窗口尺寸与 webview zoom,并把系数写回 input_zoom。
/// 尺寸 = 基础尺寸(input_w/input_h,物理)x 系数,收口走 display_size(clamp_intent=false:
/// 宽度不套 240-900,只与当前显示器工作区 80% 取较小者;高度仍钳 35-320)。
/// 与 apply_size 共用同一函数,只是「是否套 240-900」不同。
pub fn apply_scale(app: &AppHandle, scale: f64) -> Result<(), String> {
    let s = clamp_scale(scale);
    let Some(win) = app.get_webview_window("input") else {
        input_geom::set(app, "input_zoom", &format!("{s:.2}"));
        return Ok(());
    };
    let sf = win.scale_factor().unwrap_or(1.0);
    let base_w = input_geom::get_num(app, "input_w").unwrap_or(DEFAULT_WIDTH as f64 * sf);
    let base_h = input_geom::get_num(app, "input_h").unwrap_or(DEFAULT_HEIGHT as f64 * sf);
    // 截断会带来系统性持续下偏,这里四舍五入;高度与 apply_size 用同一区间兜底
    let (lw, lh) = scaled_size(
        (base_w / sf).round().max(1.0) as u32,
        (base_h / sf).round().max(1.0) as u32,
        s,
    );
    let phys = display_size(lw, lh, sf, work_area_of(&win), false);
    win.set_size(PhysicalSize::new(phys.0, phys.1))
        .map_err(|e| e.to_string())?;
    win.set_zoom(s).map_err(|e| e.to_string())?;
    input_geom::set(app, "input_zoom", &format!("{s:.2}"));
    Ok(())
}

use super::input_overlay;

#[cfg(test)]
#[path = "input_scale_tests.rs"]
mod input_scale_tests;
