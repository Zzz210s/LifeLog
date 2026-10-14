//! 宽度换算/钳制测试(纯函数,不触碰窗口句柄)。
//! 与 input_width.rs 拆开的原因同输入侧:单个文件守 200 行上限。
use super::*;
use super::super::input_height::height_phys;
use super::super::input_scale::{scaled_size, MAX_HEIGHT};

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
fn clamp_width_from_keeps_drag_continuous_when_base_outside_range() {
    // 基线在区间内:与硬区间同值
    assert_eq!(clamp_width_from(500.0, 100), MIN_WIDTH);
    assert_eq!(clamp_width_from(500.0, 5000), MAX_WIDTH);
    assert_eq!(clamp_width_from(500.0, 620), 620);
    // 基线取不到(非有限)按硬区间
    assert_eq!(clamp_width_from(f64::NAN, 700), 700);
}

#[test]
fn clamp_width_from_extends_range_to_outside_base() {
    // 2026-10-14 装机版实测:zoom 2.0、input_w 1100 被工作区 80% 收口到 1536 物理像素
    // = 1228 逻辑宽,左边缘拖进 20 物理像素(16 逻辑像素)时宽度从 1536 跳到 1125 物理像素
    assert_eq!(clamp_width_from(1228.8, 1213), 1213);
    // 已经在区间外:往区间外拖不动(工作区收口已经是上限)
    assert_eq!(clamp_width_from(1228.8, 1500), 1229);
    // 朝区间内拖到哪就是哪,进入 240-900 后硬区间照常生效
    assert_eq!(clamp_width_from(1228.8, 900), 900);
    assert_eq!(clamp_width_from(1228.8, 100), MIN_WIDTH);
    // 下限同理:缩小后的 120 逻辑宽只能朝区间内连续长,不会一跳跳到 240
    assert_eq!(clamp_width_from(120.0, 70), 120);
    assert_eq!(clamp_width_from(120.0, 200), 200);
    // 与显示换算串起来:基线 1228.8 拖进 16 逻辑像素 -> 1213 x 1.25 = 1516 物理像素
    // (而硬区间会给出 1125),工作区 1536 不参与收口
    assert_eq!(display_width(1213, 1.25, Some((1920, 1080)), Some(1228.8)), 1516);
    assert_eq!(display_width(1213, 1.25, Some((1920, 1080)), None), 1516);
}

#[test]
fn work_area_cap_is_80_percent_per_axis() {
    // 宽高各自独立与工作区 80% 收口:1920x1080 -> 1536x864(宽度按显示逻辑宽收口)
    assert_eq!(display_width(2000, 1.0, Some((1920, 1080)), None), 1536);
    // 高度:最大内容 360 x 2.0 = 720,与工作区 900 的 80%(720)相等;工作区 800 -> 640 才真压下来
    assert_eq!(height_phys(MAX_HEIGHT, 1.0, 2.0, Some(900)), 720);
    assert_eq!(height_phys(MAX_HEIGHT, 1.0, 2.0, Some(800)), 640);
    // 不冲突时原样保留
    assert_eq!(display_width(800, 1.0, Some((1920, 1080)), None), 800);
}

#[test]
fn work_area_cap_wins_over_max_width() {
    // 钳制顺序:先钳 240-900,再与工作区 80% 取较小者 -> 冲突时 80% 优先(小屏不被 900 顶出工作区)
    let clamped = clamp_width(1200); // 先落到硬上限 900
    assert_eq!(clamped, MAX_WIDTH);
    // 工作区 800 宽 -> 80% = 640,小于 900:取 640
    assert_eq!(display_width(clamped, 1.0, Some((800, 300)), Some(900.0)), 640);
    // 高度同理:硬上限(基础逻辑 360,即 5 行 + 8 条候选)与工作区 300 的 80%(240)冲突时取 240
    assert_eq!(height_phys(10_000, 1.0, 1.0, Some(300)), 240);
    // 不冲突时两边都不变:宽度取硬上限本身
    assert_eq!(display_width(MAX_WIDTH, 1.0, Some((1920, 1080)), Some(900.0)), MAX_WIDTH);
}

#[test]
fn display_width_caps_command_path_to_work_area() {
    // 宽度命令路径(apply_size,clamp_intent=true):1024x768 工作区的 80% 宽 = 819,
    // 小于 900 硬上限 -> 意图 900 也得 819(而非越界的 900/1125)
    assert_eq!(display_width(900, 1.0, Some((1024, 768)), Some(900.0)), 819);
    // 同一小屏在系统缩放 1.25 下同样收口到 819(先物理换算 1125,再与工作区 80% 取小)
    assert_eq!(display_width(900, 1.25, Some((1024, 768)), Some(900.0)), 819);
    // 取不到工作区时只做硬区间与物理换算
    assert_eq!(display_width(900, 1.25, None, Some(900.0)), 1125);
    // 工作区充足时不收口
    assert_eq!(display_width(900, 1.25, Some((1920, 1080)), Some(900.0)), 1125);
}

#[test]
fn display_width_scale_path_ignores_width_intent_range() {
    // 缩放路径(clamp_intent=false):基宽 900 逻辑 @2.0 -> 1800,不再被 900 硬上限卡住,
    // 只被工作区 80%(1920x1080 -> 1536)收口 —— 宽度与字号才真正等比。
    let lw = scaled_size(900, 87, 2.0).0;
    assert_eq!(lw, 1800);
    assert_eq!(display_width(lw, 1.0, Some((1920, 1080)), None), 1536);
    // 工作区足够大时完全不被 900 或工作区改变
    assert_eq!(display_width(lw, 1.0, Some((3840, 2160)), None), 1800);
    // 下限同理不强制 240:缩小后的 100 逻辑像素原样保留
    assert_eq!(display_width(100, 1.0, None, None), 100);
}

#[test]
fn display_width_drag_intent_path_still_clamps_to_900() {
    // 拖动意图 5000 仍被钳到 900(工作区 80% = 1536 > 900,不参与收口)
    assert_eq!(display_width(5000, 1.0, Some((1920, 1080)), Some(500.0)), MAX_WIDTH);
    // 拖动意图 100 被抬到 240
    assert_eq!(display_width(100, 1.0, None, Some(500.0)), MIN_WIDTH);
}

