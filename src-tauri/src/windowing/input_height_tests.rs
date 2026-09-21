//! input_height 纯函数测试:基础逻辑高度 -> 落库基础物理高度 / 落窗口物理高度。
//! 重点回归:R5-2 复现过的“缩放派生值被写回设置”(2026-09-21 实测 input_w 343 -> 311)。
use super::super::input_scale::{MAX_HEIGHT, MIN_HEIGHT};
use super::*;

#[test]
fn base_h_phys_is_physical_size_at_zoom_one() {
    // 基础逻辑高度 x 系统缩放,四舍五入到整数物理像素
    assert_eq!(base_h_phys(87, 1.0), 87);
    assert_eq!(base_h_phys(87, 1.25), 109);
    assert_eq!(base_h_phys(69, 1.5), 104);
    // 非有限/非正的系统缩放按 1.0,商不落到 0
    assert_eq!(base_h_phys(87, f64::NAN), 87);
    assert_eq!(base_h_phys(87, 0.0), 87);
    assert_eq!(base_h_phys(0, 1.0), MIN_HEIGHT);
}

#[test]
fn base_h_phys_clamps_to_hard_range() {
    assert_eq!(base_h_phys(10_000, 1.0), MAX_HEIGHT);
    assert_eq!(base_h_phys(1, 1.0), MIN_HEIGHT);
    assert_eq!(base_h_phys(MIN_HEIGHT, 1.0), MIN_HEIGHT);
    assert_eq!(base_h_phys(MAX_HEIGHT, 1.0), MAX_HEIGHT);
}

#[test]
fn height_phys_multiplies_by_system_scale_and_zoom() {
    // 落窗口 = 基础逻辑高度 x sf x zoom(高度与字号等比:缩放只改物理尺寸)
    assert_eq!(height_phys(87, 1.0, 1.0, None), 87);
    assert_eq!(height_phys(87, 1.25, 1.0, None), 109);
    assert_eq!(height_phys(87, 1.25, 2.0, None), 218);
    assert_eq!(height_phys(87, 1.25, 0.5, None), 54);
    // 缩放越界收敛到 0.5-2.0,NaN 回退 1.0
    assert_eq!(height_phys(100, 1.0, 9.0, None), 200);
    assert_eq!(height_phys(100, 1.0, f64::NAN, None), 100);
}

#[test]
fn height_phys_caps_to_work_area_height() {
    // 工作区 1080 的 80% = 864:2.0 缩放下的大高度被收口(与宽度同一收口比例)
    assert_eq!(height_phys(MAX_HEIGHT, 1.0, 2.0, Some(1080)), 864);
    // 不冲突时原样保留
    assert_eq!(height_phys(87, 1.0, 1.0, Some(1080)), 87);
    // 取不到工作区时不收口
    assert_eq!(height_phys(MAX_HEIGHT, 1.0, 2.0, None), 1120);
}

#[test]
fn stored_base_height_never_contains_the_zoom_factor() {
    // R5-2 回归:同一内容高度在任何缩放档位下写回库的值完全相同 —— base_h_phys 结构上拿不到
    // 缩放值,「读缩放与写库交错」这条竞态因此不可能再把派生值固化(set_input_size 的旧路径
    // 会按 意图 x sf / 缩放 换算,交错时把 343 写成 311)。
    let (base_logical, sf) = (87u32, 1.25f64);
    let stored = base_h_phys(base_logical, sf);
    for zoom in [0.5, 1.0, 1.1, 1.3, 1.5, 2.0] {
        assert_eq!(base_h_phys(base_logical, sf), stored, "zoom {zoom} 下库值必须相同");
        // 而落窗口的物理高度按缩放等比变化(缩放确实生效,只是不进库)
        let phys = height_phys(base_logical, sf, zoom, None);
        assert_eq!(phys, ((base_logical as f64) * sf * zoom).round() as u32);
    }
    // 写入命令 set_input_height 只接受高度一个参数:调用方没有任何途径把窗口宽度送进来
    assert_eq!(stored, 109);
}
