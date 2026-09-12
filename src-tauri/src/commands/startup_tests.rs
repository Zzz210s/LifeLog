//! 开机启动决策的纯函数测试:期望值 x 系统真实状态(存在/生效/路径) -> 是否写注册表
use super::*;

/// 构造真实状态的简写:exists/enabled/path_ok
fn state(exists: bool, enabled: bool, path_ok: bool) -> RunState {
    RunState { exists, enabled, path_ok }
}

#[test]
fn no_write_when_registry_already_matches() {
    // W1:Run 值不存在 + 期望关闭 -> 不写注册表(否则 disable 报 NotFound 被当成失败)
    assert_eq!(plan_write(false, state(false, false, false)), AutostartWrite::None);
    // 存在、生效且路径正确 + 期望开启 -> 稳定态
    assert_eq!(plan_write(true, state(true, true, true)), AutostartWrite::None);
}

#[test]
fn writes_only_on_difference() {
    // 存在且期望关 -> 删值
    assert_eq!(plan_write(false, state(true, true, true)), AutostartWrite::Disable);
    // 不存在且期望开 -> 新建
    assert_eq!(plan_write(true, state(false, false, false)), AutostartWrite::Rewrite);
    // 值被任务管理器禁用(存在但未生效)+ 期望开 -> 重写把它重新启用
    assert_eq!(plan_write(true, state(true, false, true)), AutostartWrite::Rewrite);
}

#[test]
fn rewrites_when_registered_path_is_stale() {
    // 审查点名的场景:注册表里残留 dev/旧安装路径,is_enabled() 仍为 true。
    // 只比布尔值会判「无需写」、修复按钮静默 no-op,故路径不一致必须重写。
    assert_eq!(plan_write(true, state(true, true, false)), AutostartWrite::Rewrite);
    // 路径失效时即使期望关闭也照常清理该残留值
    assert_eq!(plan_write(false, state(true, true, false)), AutostartWrite::Disable);
}

#[test]
fn path_match_ignores_args_quotes_and_case() {    let cur = r"E:\1-app-lifelog\app-lifelog.exe";
    // auto-launch 的实际写法:路径 + 空格 + 参数
    assert!(path_matches(r"E:\1-app-lifelog\app-lifelog.exe --minimized", cur));
    // 带引号的值(安装器/手工写过)
    assert!(path_matches(r#""E:\1-app-lifelog\app-lifelog.exe" --minimized"#, cur));
    // Windows 路径大小写不敏感
    assert!(path_matches(r"e:\1-APP-LIFELOG\app-lifelog.exe", cur));
    // 残留路径(dev 调试产物)与另一个同名 exe 都不算匹配
    assert!(!path_matches(r"E:\0-cargo-target\app-lifelog\debug\app-lifelog.exe --minimized", cur));
    assert!(!path_matches(r"E:\1-app-lifelog\other.exe --minimized", cur));
}

#[test]
fn status_wire_keys_match_the_frontend_expectations() {
    // 前端(shared/api.ts + startup-settings.ts)按 Rust 字段名 snake_case 直读(path_ok);
    // 这里钉住 IPC 键名 —— 本轮 release 冒烟就抓到过一次「结构体叫 path_ok、前端读 pathOk」的
    // 静默错配:界面于是永远显示「需要修复」(undefined 为假),而注册表其实是好的。
    let v = serde_json::to_value(AutostartStatus { enabled: true, path_ok: false }).unwrap();
    assert_eq!(v["enabled"], serde_json::json!(true));
    assert_eq!(v["path_ok"], serde_json::json!(false));
    assert!(v.get("pathOk").is_none());
}
