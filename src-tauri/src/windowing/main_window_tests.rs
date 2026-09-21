//! 主窗延后创建的纯逻辑测试:不构建真实窗口,只钉住 pending 语义与构建参数。
use super::*;

/// 取走即清空,避免第二次打开主窗又被切到设置页
#[test]
fn pending_flag_is_taken_once() {
    reset_pending();
    set_pending();
    assert!(take_pending());
    assert!(!take_pending());
}

#[test]
fn pending_flag_starts_clear() {
    reset_pending();
    assert!(!take_pending());
}

/// 两条投递通道:新建窗口只留 pending(页面还没订阅,事件必丢);
/// 窗口已存在则 pending + 事件都发 —— 「已存在」不等于「已订阅」(刚建窗/正在重载)
#[test]
fn intent_channels_cover_both_window_states() {
    assert_eq!(intent_channels(false), (true, false), "新建:事件发给不存在的监听者,只留 pending");
    assert_eq!(intent_channels(true), (true, true), "已存在:事件即时切页 + pending 兜底");
}

/// 构建参数必须与迁移前 tauri.conf.json 的 main 声明等价
#[test]
fn build_config_matches_legacy_window_declaration() {
    let c = build_config();
    assert_eq!(c.title, "拾枝");
    assert_eq!(c.url, "index.html");
    assert_eq!(c.width, 1100.0);
    assert_eq!(c.height, 720.0);
    assert!(!c.drag_drop_enabled);
    // 声明里 visible=false:建完由 open() 显式 show,避免半成品窗口先露出来
    assert!(!c.visible);
}

#[test]
fn 主窗失焦事件名与前端约定一致() {
    // 前端 use-leave-save.ts 的 BLUR_SAVE_EVENT 必须是同一个字符串,否则"点到窗口外也保存"会静默失效
    assert_eq!(super::BLUR_SAVE_EVENT, "main-window-blur");
}
