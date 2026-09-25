//! 启动动作的纯逻辑测试:与前端 src/shared/startup-action.test.ts 钉住同一真值表
use super::*;

#[test]
fn show_input_when_setting_is_input_bar() {
    assert_eq!(resolve_startup_action(true, false), StartupAction::ShowInput);
    assert_eq!(resolve_startup_action(true, true), StartupAction::ShowInput);
}

#[test]
fn tray_only_when_setting_is_tray_only() {
    assert_eq!(resolve_startup_action(false, false), StartupAction::TrayOnly);
    assert_eq!(resolve_startup_action(false, true), StartupAction::TrayOnly);
}

/// 拉起方式不改变动作(spec 3.1:手动启动与开机自启一致)
#[test]
fn launch_mode_does_not_change_action() {
    assert_eq!(resolve_startup_action(true, true), resolve_startup_action(true, false));
    assert_eq!(resolve_startup_action(false, true), resolve_startup_action(false, false));
}

/// 白名单解析:'tray-only' 之外一律按默认(input-bar)处理
#[test]
fn setting_whitelist_falls_back_to_input_bar() {
    assert!(show_input_from_setting(None));
    assert!(show_input_from_setting(Some("")));
    assert!(show_input_from_setting(Some("input-bar")));
    assert!(show_input_from_setting(Some("nonsense")));
    assert!(show_input_from_setting(Some("TRAY-ONLY")));
    assert!(!show_input_from_setting(Some("tray-only")));
}

#[test]
fn tutorial_seen_only_accepts_1() {
    // 只有 "1" 算看过;空串(清标记重看)、缺失、其它值都算未看过
    assert!(seen_from_setting(Some("1")));
    assert!(!seen_from_setting(Some("")));
    assert!(!seen_from_setting(None));
    assert!(!seen_from_setting(Some("0")));
    assert!(!seen_from_setting(Some("true")));
}
