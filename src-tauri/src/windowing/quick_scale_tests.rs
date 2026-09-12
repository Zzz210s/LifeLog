//! 快捷窗尺寸换算测试(纯函数,不触碰窗口句柄)
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
fn window_height_adds_padding() {
    assert_eq!(window_height_for_lines(1, 20.0, 14.0), 48);
    assert_eq!(window_height_for_lines(5, 20.0, 14.0), 128);
}

#[test]
fn window_height_clamps_lines_and_rounds() {
    assert_eq!(window_height_for_lines(0, 20.0, 14.0), 48);
    assert_eq!(window_height_for_lines(9, 20.0, 14.0), 128);
    // 22.75 x 3 + 28 = 96.25 -> 96
    assert_eq!(window_height_for_lines(3, 22.75, 14.0), 96);
}
