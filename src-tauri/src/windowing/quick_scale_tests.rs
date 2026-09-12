//! 快捷窗尺寸/缩放钳制测试(纯函数,不触碰窗口句柄)
use super::*;

#[test]
fn clamp_width_bounds() {
    assert_eq!(clamp_width(100), 240);
    assert_eq!(clamp_width(2000), 900);
    assert_eq!(clamp_width(500), 500);
}

#[test]
fn clamp_width_keeps_bounds() {
    assert_eq!(clamp_width(MIN_WIDTH), 240);
    assert_eq!(clamp_width(MAX_WIDTH), 900);
}

#[test]
fn clamp_height_bounds() {
    // 0 与过小的值兜底到 1 行 @0.5x 缩放下界
    assert_eq!(clamp_height(0), MIN_HEIGHT);
    assert_eq!(clamp_height(1), MIN_HEIGHT);
    // 过大的值兜底到 5 行 @2.0x 缩放上界
    assert_eq!(clamp_height(10_000), MAX_HEIGHT);
}

#[test]
fn clamp_height_keeps_bounds() {
    assert_eq!(clamp_height(MIN_HEIGHT), MIN_HEIGHT);
    assert_eq!(clamp_height(MAX_HEIGHT), MAX_HEIGHT);
    assert_eq!(clamp_height(120), 120);
}

#[test]
fn clamp_scale_bounds() {
    assert_eq!(clamp_scale(0.2), 0.5);
    assert_eq!(clamp_scale(9.0), 2.0);
    assert_eq!(clamp_scale(f64::NAN), 1.0);
    assert_eq!(clamp_scale(1.25), 1.25);
}

#[test]
fn scaled_size_rounds() {
    assert_eq!(scaled_size(420, 300, 1.5), (630, 450));
    assert_eq!(scaled_size(420, 300, 0.5), (210, 150));
    assert_eq!(scaled_size(0, 0, 1.0), (1, 1));
}

#[test]
fn cap_to_work_area_is_80_percent_per_axis() {
    assert_eq!(cap_to_work_area(2000, 1600, 1920, 1080), (1536, 864));
    assert_eq!(cap_to_work_area(800, 600, 1920, 1080), (800, 600));
}

#[test]
fn base_size_divides_by_scale() {
    assert_eq!(base_size_from_actual(630, 450, 1.5), (420, 300));
    assert_eq!(base_size_from_actual(420, 300, 1.0), (420, 300));
    // 非有限系数按 1.0 处理;过小的商不落到 0
    assert_eq!(base_size_from_actual(420, 300, f64::NAN), (420, 300));
    assert_eq!(base_size_from_actual(1, 1, 2.0), (1, 1));
}
