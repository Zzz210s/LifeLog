//! 输入栏尺寸与视图缩放:尺寸钳制、缩放换算、落到窗口并落库。
//! 单位约定:宽度入参是**当前逻辑像素**(拖动意图区间 240-900);高度入参是**基础逻辑高度**
//! (缩放无关,见 input_height);缩放路径(apply_scale)只受工作区 80% 上限。
//! 设置里的 input_w/input_h 存**基础物理尺寸**(缩放系数为 1 时的物理尺寸),显示时按 input_zoom
//! 乘开后落到窗口;缩放系数存 input_zoom(0.5-2.0)。基础尺寸只由**命令意图**写回;
//! hide() 只写位置,绝不由窗口实际尺寸反推(会把钳制结果固化)。旧语义(含缩放的尺寸)由
//! input_geom::migrate_geometry 一次性迁移。
//!
//! 宽度只由本文件的 apply_size(拖动路径)写回;自动高度路径走 input_height::apply_height ——
//! 它**绝不写 input_w**(该路径只知道“窗口现在多宽”,那不是用户意图)。

use super::input_geom;
use tauri::{AppHandle, Manager, PhysicalSize, WebviewWindow};


pub const MIN_WIDTH: u32 = 240;
pub const MAX_WIDTH: u32 = 900;

/// 高度区间(基础逻辑像素 —— 与 input_height 的入参同一单位):
/// 单行 CSS 高度 = 22.75(text-sm + leading-relaxed)+ 上下内边距与边框 18 + 光晕内边距 2 x 14
/// = 68.75;5 行为 159.75(向上取整 160)。上界 = 最大内容 = 5 行(160)+ # 补全建议列表
/// 8 行 x 24 + 面板内边距 8(200)= 360 —— 建议列表是窗口内的一部分(像浏览器搜索框下方的
/// 推荐列表),故上界要把它算进去。下界 35 故意低于单行(69):它只是兜底(缩放 0.5 时
/// 窗口高仅 17.5 CSS,输入框自己可滚),拦下 0 与异常小的值。
/// **这两个界限只作用于基础逻辑高度**(缩放无关),缩放只乘在落窗口的物理尺寸上;
/// 旧版把上界 560 当成“缩放态量”套在含缩放的逻辑高上(与新路径不自洽,zoom 2.0 下两路径
/// 差 164 物理 px),2026-09-21 复审 Important 1 已统一到本侧。
/// 与前端常量同源:MAX_LINES=5 与 SUGGEST_MAX_ROWS=8(任何一方调大都要同步这里)。
pub const MIN_HEIGHT: u32 = 35;
pub const MAX_HEIGHT: u32 = 360;

pub const MIN_SCALE: f64 = 0.5;
pub const MAX_SCALE: f64 = 2.0;

/// 缩放后的窗口不得超出当前显示器工作区的这个比例(宽度与高度共用)
pub(super) const WORK_AREA_RATIO: f64 = 0.8;
/// 设置缺失时的基础尺寸(逻辑像素),与 tauri.conf.json 的 input 窗口默认值一致
const DEFAULT_WIDTH: u32 = 420;
const DEFAULT_HEIGHT: u32 = 300;

/// 宽度钳制(逻辑像素):240-900。
pub fn clamp_width(w: u32) -> u32 {
    w.clamp(MIN_WIDTH, MAX_WIDTH)
}

/// 高度钳制(基础逻辑像素):35-360。高度由前端按真实换行测量后传入,此处只做兜底。
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

/// 逻辑宽 -> 落窗口的物理宽(唯一的宽度换算;高度一律走 input_height::height_phys):
/// 「(可选)按拖动意图钳 240-900 -> 物理换算 -> 与当前显示器工作区 80% 取较小者」
/// `clamp_intent` = 是否把宽度当「用户拖动意图」套 240-900:
/// - true:宽度拖动命令路径(apply_size),手动拖宽/拖窄的 240-900 区间生效;
/// - false:缩放路径(apply_scale),只受工作区 80% 上限 —— 基宽 >450 放大到 2.0 时若套 900
///   硬上限,宽度会卡住而字号继续变大,"窗口与字号等比"不成立;下限同理不强制 240
///   (等比缩放允许变小,缩放系数本身已 0.5-2.0)。
///
/// 取不到工作区(无显示器信息)时只做前面的步骤。
pub fn display_width(logical_w: u32, sf: f64, work: Option<(u32, u32)>, clamp_intent: bool) -> u32 {
    let sf = if sf.is_finite() && sf > 0.0 { sf } else { 1.0 };
    let lw = if clamp_intent { clamp_width(logical_w) } else { logical_w.max(1) };
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

/// 宽度拖动路径(唯一会写 input_w 的路径):宽度按当前逻辑像素意图套 240-900 后收口,
/// 高度入参是**基础逻辑高度**(缩放无关,与 input_height 同源)。
/// 写回设置一律用命令意图:宽度只在真的变化时才写(拖动中每帧都带宽度),
/// 高度每次都按内容意图写回;收口结果绝不固化成基础尺寸。
pub fn apply_size(app: &AppHandle, width: u32, height_base: u32) -> Result<(), String> {
    let Some(win) = app.get_webview_window("input") else {
        return Ok(());
    };
    let sf = win.scale_factor().unwrap_or(1.0);
    let zoom = super::input_height::current_zoom(app);
    input_overlay::restore(&win); // 列表关掉时先还原"为列表让位"的临时位移
    let work = work_area_of(&win);
    // 宽度:拖动意图(唯一会写 input_w 的路径)走唯一的宽度换算
    let phys_w = display_width(width, sf, work, true);
    // 高度:基础逻辑高度 -> 物理高度(缩放只乘在这里,不进库)
    let phys_h = super::input_height::height_phys(height_base, sf, zoom, work.map(|a| a.1));
    let width_changed = win
        .inner_size()
        .map(|s| width_intent_changed(s.to_logical::<f64>(sf).width, width))
        .unwrap_or(false);
    win.set_size(PhysicalSize::new(phys_w, phys_h))
        .map_err(|e| e.to_string())?;
    if width_changed {
        input_geom::set(app, "input_w", &base_from_intent(width, sf, zoom).to_string());
    }
    let base_h = super::input_height::base_h_phys(height_base, sf);
    input_geom::set(app, "input_h", &base_h.to_string());
    Ok(())
}

/// 按缩放系数设置窗口尺寸与 webview zoom,并把系数写回 input_zoom。
/// 尺寸 = 基础尺寸(input_w/input_h,物理)x 系数,收口走 display_width(clamp_intent=false:
/// 宽度不套 240-900,只与当前显示器工作区 80% 取较小者);
/// **高度与自动高度路径共用同一个换算** input_height::height_phys_from_base(基础物理高 ->
/// 基础逻辑高 -> x sf x 缩放 -> 工作区收口),两条路径对同一内容给出同一窗口高。
pub fn apply_scale(app: &AppHandle, scale: f64) -> Result<(), String> {
    let s = clamp_scale(scale);
    let Some(win) = app.get_webview_window("input") else {
        input_geom::set(app, "input_zoom", &format!("{s:.2}"));
        return Ok(());
    };
    let sf = win.scale_factor().unwrap_or(1.0);
    let base_w = input_geom::get_num(app, "input_w").unwrap_or(DEFAULT_WIDTH as f64 * sf);
    let base_h = input_geom::get_num(app, "input_h").unwrap_or(DEFAULT_HEIGHT as f64 * sf);
    // 截断或四舍五入产生的误差:宽度先按「基础逻辑 x 缩放」算出显示逻辑宽,再交给唯一换算
    let logical_w = (base_w / sf).round().max(1.0) as u32;
    let work = work_area_of(&win);
    let phys_w = display_width(scaled_size(logical_w, MIN_HEIGHT, s).0, sf, work, false);
    // 高度:库里的基础物理高 -> 落窗口物理高(缩放只乘在物理尺寸上,绝不落库)
    let base_h = base_h.round().max(1.0) as u32;
    let phys_h = super::input_height::height_phys_from_base(base_h, sf, s, work.map(|a| a.1));
    win.set_size(PhysicalSize::new(phys_w, phys_h))
        .map_err(|e| e.to_string())?;
    win.set_zoom(s).map_err(|e| e.to_string())?;
    input_geom::set(app, "input_zoom", &format!("{s:.2}"));
    Ok(())
}

use super::input_overlay;

#[cfg(test)]
#[path = "input_scale_tests.rs"]
mod input_scale_tests;
