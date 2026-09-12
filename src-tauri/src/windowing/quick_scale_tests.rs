//! 快捷窗尺寸钳制测试(纯函数,不触碰窗口句柄)
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
