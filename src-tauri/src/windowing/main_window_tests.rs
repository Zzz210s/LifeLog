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
