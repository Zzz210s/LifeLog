//! 应用内快捷键纯逻辑测试:元数据契约、冲突矩阵(系统级 / 彼此)、语法非法、规范化落库、清除。
use super::*;

fn palette() -> &'static Kind {
    of("palette").expect("palette 必须是已知用途")
}

#[test]
fn kind_metadata_matches_frontend_contract() {
    assert_eq!(of("palette").unwrap().setting_key, "main_palette_hotkey");
    assert_eq!(of("quickOpen").unwrap().setting_key, "main_quick_open_hotkey");
    assert_eq!(of("palette").unwrap().default, "ctrl+shift+p");
    assert_eq!(of("quickOpen").unwrap().default, "ctrl+p");
    assert_eq!(of("palette").unwrap().label, "命令面板");
    assert_eq!(of("quickOpen").unwrap().label, "快速打开笔记");
    assert!(of("nope").unwrap_err().contains("未知的快捷键用途"));
    assert!(is_setting_key("main_palette_hotkey") && is_setting_key("main_quick_open_hotkey"));
    assert!(!is_setting_key("input_hotkey"));
    assert_eq!(other("palette").kind, "quickOpen");
    assert_eq!(other("quickOpen").kind, "palette");
}

#[test]
fn conflict_with_system_global_hotkey() {
    // 写法规格化后比对:大小写不同也判为冲突
    let msg = decide("palette", "Ctrl+Shift+Q", Some("ctrl+shift+q"), None).unwrap_err();
    assert!(msg.contains("系统级全局快捷键"), "{msg}");
    // 系统级键的库值非法时按生效值比:非法的全局值等于没设,不该误报
    let ok = decide("palette", "ctrl+shift+q", Some("不是键名"), None).unwrap();
    assert_eq!(ok, "ctrl+shift+q");
    // 全局键没有生效值(注册失败)时同样不误报
    assert_eq!(decide("palette", "ctrl+shift+q", None, None).unwrap(), "ctrl+shift+q");
}

#[test]
fn conflict_between_the_two_app_hotkeys() {
    // 另一个键的库值命中
    let msg = decide("palette", "ctrl+p", None, Some("ctrl+p")).unwrap_err();
    assert!(msg.contains("快速打开笔记"), "{msg}");
    // 另一个键没设置过时用的是它的**默认键**,同样算冲突
    let msg = decide("quickOpen", "ctrl+shift+p", None, None).unwrap_err();
    assert!(msg.contains("命令面板"), "{msg}");
    // 两个键各自都没被占用时不误报
    assert_eq!(decide("quickOpen", "ctrl+alt+k", None, None).unwrap(), "ctrl+alt+k");
}

#[test]
fn rejects_illegal_syntax_with_chinese_reason() {
    // 单键非 F1-F24
    assert!(decide("palette", "k", None, None).unwrap_err().contains("F1-F24"));
    // 2-3 键缺修饰键 / 缺主键 / 多主键 / 超 3 键
    assert!(decide("palette", "ctrl+shift", None, None).unwrap_err().contains("主键"));
    assert!(decide("palette", "p+q", None, None).unwrap_err().contains("只能有一个主键"));
    assert!(decide("palette", "ctrl+alt+shift+p", None, None).unwrap_err().contains("3 个键"));
    // 未知键名:TS 的形态预检会放行,这里必须挡住(否则落库就是死键)
    assert!(decide("palette", "ctrl+zzz", None, None).unwrap_err().contains("无法识别的按键"));
    assert!(decide("palette", "ctrl+f25", None, None).unwrap_err().contains("无法识别"));
    assert!(decide("palette", "ctrl+intlbackslash", None, None).unwrap_err().contains("无法识别"));
}

#[test]
fn stores_only_normalized_values() {
    assert_eq!(decide("palette", " shift + ctrl + P ", None, None).unwrap(), "ctrl+shift+p");
    assert_eq!(decide("palette", "ctrl+esc", None, None).unwrap(), "ctrl+escape");
    assert_eq!(decide("quickOpen", "win+Digit5", None, None).unwrap(), "super+5");
    assert_eq!(decide("quickOpen", "cmdorctrl+alt+k", None, None).unwrap(), "ctrl+alt+k");
}

#[test]
fn clear_is_an_empty_value_and_reads_back_as_default() {
    assert_eq!(decide("palette", "", None, None).unwrap(), CLEARED);
    assert_eq!(decide("palette", "   ", None, Some("ctrl+p")).unwrap(), CLEARED);
    assert_eq!(effective(None, palette()), "ctrl+shift+p");
    assert_eq!(effective(Some(""), palette()), "ctrl+shift+p");
    assert_eq!(effective(Some("不是键名"), palette()), "ctrl+shift+p");
    assert_eq!(effective(Some("Ctrl+Alt+K"), palette()), "ctrl+alt+k");
}
