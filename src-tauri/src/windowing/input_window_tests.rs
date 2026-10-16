//! 输入栏延后创建的纯逻辑测试:不构建真实窗口,只钉住标签与构建参数。
use super::*;

/// 构建参数必须与迁移前 tauri.conf.json 的 input 声明逐项等价(任何一项漂移都是行为回归)
#[test]
fn build_config_matches_legacy_window_declaration() {
    let c = build_config();
    assert_eq!(c.title, "输入栏");
    assert_eq!(c.url, "input.html");
    assert_eq!(c.width, 420.0);
    assert_eq!(c.height, 300.0);
    assert!(!c.visible, "声明 visible=false:建完由 show() 显式显示");
    assert!(!c.decorations);
    assert!(c.skip_taskbar);
    assert!(c.always_on_top);
    assert!(!c.resizable);
    assert!(c.transparent);
    assert!(!c.shadow);
}

/// 标签是跨模块字符串约定:前端 getCurrentWindow、commands::notes 的定向通知都按它寻址
#[test]
fn label_matches_cross_module_contract() {
    assert_eq!(INPUT_LABEL, "input");
}
