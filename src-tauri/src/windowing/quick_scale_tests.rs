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
fn work_area_cap_wins_over_max_width() {
    // 钳制顺序:先钳 240-900,再与工作区 80% 取较小者 -> 冲突时 80% 优先(小屏不被 900 顶出工作区)
    let clamped = clamp_width(1200); // 先落到硬上限 900
    assert_eq!(clamped, MAX_WIDTH);
    // 工作区 800 宽 -> 80% = 640,小于 900:取 640
    assert_eq!(cap_to_work_area(clamped, MAX_HEIGHT, 800, 600).0, 640);
    // 高度同理:硬上限 320 与工作区 300 的 80%(240)冲突时取 240
    assert_eq!(cap_to_work_area(MIN_WIDTH, clamp_height(10_000), 800, 300).1, 240);
    // 不冲突时两边都不变
    assert_eq!(cap_to_work_area(MAX_WIDTH, MAX_HEIGHT, 1920, 1080), (900, 320));
}

#[test]
fn base_size_divides_by_scale() {
    assert_eq!(base_size_from_actual(630, 450, 1.5), (420, 300));
    assert_eq!(base_size_from_actual(420, 300, 1.0), (420, 300));
    // 非有限系数按 1.0 处理;过小的商不落到 0
    assert_eq!(base_size_from_actual(420, 300, f64::NAN), (420, 300));
    assert_eq!(base_size_from_actual(1, 1, 2.0), (1, 1));
}

#[test]
fn base_roundtrip_error_stays_within_one_pixel() {
    // 「基础 x 系数 -> 实际 -> 除回系数」在非钳制区间内单次往返误差不超过 1 像素
    for base in [(404u32, 87u32), (420, 300), (700, 200), (900, 320), (240, 35)] {
        for s in [0.5, 1.0, 1.3, 1.5, 2.0] {
            let actual = scaled_size(base.0, base.1, s);
            let back = base_size_from_actual(actual.0, actual.1, s);
            let dw = (back.0 as i64 - base.0 as i64).abs();
            let dh = (back.1 as i64 - base.1 as i64).abs();
            assert!(dw <= 1 && dh <= 1, "base {base:?} scale {s} -> {back:?}");
        }
    }
}

#[test]
fn repeated_roundtrip_has_no_systematic_drift() {
    // 四舍五入不像截断那样单向下偏:同一基础尺寸反复往返 20 次仍等值
    for (w, h) in [(404u32, 87u32), (525, 111), (700, 200)] {
        for s in [1.3, 1.5, 2.0] {
            let mut cur = (w, h);
            for _ in 0..20 {
                let actual = scaled_size(cur.0, cur.1, s);
                cur = base_size_from_actual(actual.0, actual.1, s);
            }
            assert_eq!(cur, (w, h), "base {:?} scale {s} drifted to {:?}", (w, h), cur);
        }
    }
}

#[test]
fn clamped_display_size_does_not_leak_into_stored_base() {
    let (base_w, sf, s) = (404u32, 1.25f64, 1.3f64);
    let logical = (base_w as f64 / sf).round() as u32;
    let displayed = scaled_size(logical, 87, s);
    // 工作区很小时 apply_scale 的收口会把显示宽度钳进 80%
    let capped = cap_to_work_area(displayed.0, displayed.1, 400, 400);
    let leaked = base_from_intent(capped.0, sf, s);
    assert_ne!(leaked, base_w, "钳制结果不该被当成基础尺寸");
    // 按命令意图写回才稳定
    assert_eq!(base_from_intent(displayed.0, sf, s), base_w);
}

#[test]
fn width_intent_change_has_half_pixel_tolerance() {
    assert!(!width_intent_changed(421.0, 421));
    assert!(!width_intent_changed(420.6, 421));
    assert!(width_intent_changed(420.4, 421));
    assert!(width_intent_changed(421.0, 500));
}

#[test]
fn migrate_size_converts_legacy_geometry() {
    // 本机库的旧值:含缩放的 525x111 @1.30 -> 基础 404x85
    assert_eq!(migrate_size(525.0, 111.0, 1.30), (404, 85));
    assert_eq!(migrate_size(525.0, 111.0, 1.0), (525, 111));
    assert_eq!(migrate_size(0.0, 0.0, 1.3), (1, 1));
}
