//! input_overlay 纯逻辑测试:让位位置计算与高度上限。
use super::*;
use super::super::input_scale::{clamp_height, MAX_HEIGHT, MIN_HEIGHT};

#[test]
fn overlay_position_keeps_window_inside_work_area() {
    // 工作区 (0,0,1920,1080):窗口 404x261 放在 y=900 会伸出底部 -> 上移到 1080-8-261=811
    assert_eq!(overlay_position((0, 0, 1920, 1080), (404, 261), (100, 900)), (100, 811));
    // 放得下就不动(常见情形:输入栏在屏幕中部)
    assert_eq!(overlay_position((0, 0, 1920, 1080), (404, 261), (100, 400)), (100, 400));
    // 右边缘同理
    assert_eq!(overlay_position((0, 0, 1920, 1080), (900, 120), (1100, 100)), (1012, 100));
    // 多显示器:工作区带偏移(第二屏从 x=1920 开始)
    assert_eq!(overlay_position((1920, 0, 1920, 1080), (404, 261), (2000, 900)), (2000, 811));
    // 窗口比工作区还高:钳到工作区顶边,不产生负坐标
    assert_eq!(overlay_position((0, 0, 800, 300), (404, 500), (10, 200)), (10, 0));
}

#[test]
fn overlay_height_cap_fits_input_plus_suggestion_list() {
    // 5 行 @2.0 = 320,加 8 行建议列表(24 CSS x 8 + 8)在 2.0 下约 560
    assert!(MAX_HEIGHT >= 560);
    assert_eq!(clamp_height(9999), MAX_HEIGHT);
    assert_eq!(clamp_height(0), MIN_HEIGHT);
}
