//! 快捷键纯逻辑测试(不需要 AppHandle,注册/注销留待实机验收)
use super::*;
use crate::hotkey_spec::{normalize, validate};

fn parts(raw: &str) -> Vec<String> {
    raw.split('+').map(str::to_string).collect()
}

#[test]
fn accepts_legal_combinations() {
    for (raw, want) in [
        ("f5", "f5"),
        ("F5", "f5"),
        ("f24", "f24"),
        ("ctrl+q", "ctrl+q"),
        ("ctrl+shift+q", "ctrl+shift+q"),
        ("alt+shift+l", "alt+shift+l"),
        ("super+space", "super+space"),
        // 键序规范化(H3):任意顺序输入都落成 Ctrl+Alt+Shift+Super+主键
        ("shift+ctrl+q", "ctrl+shift+q"),
        ("Q+sHiFt+CTRL", "ctrl+shift+q"),
        ("super+alt+f2", "alt+super+f2"),
        // 空白与重复修饰键被收敛
        (" ctrl + shift + q ", "ctrl+shift+q"),
        ("ctrl+ctrl+q", "ctrl+q"),
        // 插件别名归一
        ("control+option+KeyQ", "ctrl+alt+q"),
    ] {
        assert_eq!(check(raw).as_deref(), Ok(want), "应接受 {raw}");
        assert_eq!(parse(raw).as_deref(), Some(want), "{raw} 的 parse 应一致");
    }
}

#[test]
fn rejects_illegal_combinations() {
    for raw in [
        "",              // 空串
        "q",             // 单个普通键:会占用全系统按键
        "space",         // 单个非功能键
        "ctrl+shift",    // 纯修饰键
        "ctrl",          // 单个修饰键
        "unknown",       // 未知键名
        "ctrl+nope",     // 未知键名(带修饰键)
        "ctrl+alt+shift+q", // 4 键
        "ctrl+q+z",      // 两个主键
        "ctrl+alt+shift+super+q", // 5 键
    ] {
        assert!(parse(raw).is_none(), "应拒绝 {raw}");
        assert!(validate(&parts(raw)).is_err(), "validate 应拒绝 {raw}");
    }
}

#[test]
fn canonical_key_names() {
    for (raw, want) in [
        ("ctrl+a", "ctrl+a"),
        ("ctrl+5", "ctrl+5"),
        ("ctrl+up", "ctrl+arrowup"),
        ("ctrl+esc", "ctrl+escape"),
        ("ctrl+numpad0", "ctrl+numpad0"),
        ("ctrl+volumeup", "ctrl+audiovolumeup"),
        ("ctrl+mediatrackprev", "ctrl+mediatrackprevious"),
    ] {
        assert_eq!(check(raw).as_deref(), Ok(want), "规范化 {raw}");
    }
}

/// 规范名必须能被再解析且保持稳定(否则重启后注册会失败)
#[test]
fn canonical_output_is_idempotent_and_reparseable() {
    for name in [
        "a", "z", "m", "0", "9", "f1", "f12", "f24", "space", "enter", "tab", "escape", "esc",
        "backspace", "delete", "insert", "home", "end", "pageup", "pagedown", "up", "down",
        "left", "right", "minus", "equal", "comma", "period", "slash", "backslash", "semicolon",
        "quote", "backquote", "bracketleft", "bracketright", "capslock", "numlock", "scrolllock",
        "printscreen", "pause", "numpad0", "numpad9", "numpadadd", "numpadsubtract",
        "numpadmultiply", "numpaddivide", "numpaddecimal", "numpadenter", "numpadequal",
        "volumeup", "volumedown", "volumemute", "mediaplaypause", "mediastop", "mediatracknext",
        "keyq", "digit5", "arrowup",
    ] {
        let once = check(&format!("ctrl+{name}")).unwrap_or_else(|e| panic!("{name}: {e}"));
        let twice = check(&once).unwrap_or_else(|e| panic!("{once} 不能再解析: {e}"));
        assert_eq!(once, twice, "{name} 规范化不稳定");
    }
}

#[test]
fn error_reasons_are_chinese_and_specific() {
    for (raw, needle) in [
        ("", "不能为空"),
        ("q", "F1-F24"),
        ("ctrl+shift", "主键"),
        ("ctrl+q+z", "只能有一个主键"),
        ("nope", "无法识别"),
        ("ctrl+alt+shift+q", "3 个键"),
    ] {
        let err = check(raw).unwrap_err();
        assert!(err.contains(needle), "{raw} 的原因 {err} 应含 {needle}");
    }
}

#[test]
fn effective_falls_back_to_default() {
    assert_eq!(effective(None), DEFAULT_HOTKEY);
    assert_eq!(effective(Some("nope")), DEFAULT_HOTKEY);
    assert_eq!(effective(Some("")), DEFAULT_HOTKEY);
    assert_eq!(effective(Some("ctrl+shift")), DEFAULT_HOTKEY);
    // 合法但非规范的值不做回退,而是规范化(H1)
    assert_eq!(effective(Some("shift+ctrl+q")), "ctrl+shift+q");
    assert_eq!(effective(Some("alt+shift+l")), "alt+shift+l");
}

#[test]
fn attempts_prefers_stored_then_default() {
    assert_eq!(attempts(None), vec![DEFAULT_HOTKEY.to_string()]);
    assert_eq!(
        attempts(Some("alt+shift+l")),
        vec!["alt+shift+l".to_string(), DEFAULT_HOTKEY.to_string()]
    );
    // 非法值只剩默认键一次尝试;库值规范化后等于默认键时也不重复
    assert_eq!(attempts(Some("nope")), vec![DEFAULT_HOTKEY.to_string()]);
    assert_eq!(attempts(Some("shift+ctrl+q")), vec![DEFAULT_HOTKEY.to_string()]);
}

#[test]
fn normalize_takes_part_lists() {
    assert_eq!(
        normalize(&["shift".to_string(), "ctrl".to_string(), "q".to_string()]),
        Some("ctrl+shift+q".to_string())
    );
    assert_eq!(normalize(&["q".to_string()]), None);
    assert_eq!(normalize(&[]), None);
    // 空串片段被忽略而不是当成主键
    assert_eq!(
        normalize(&["".to_string(), "ctrl".to_string(), "f5".to_string()]),
        Some("ctrl+f5".to_string())
    );
}

/// 改键决策:核心是"已确认注册中的同名键不重复注册"(Windows 下重复注册必然报占用)
#[test]
fn plan_skips_reregistering_the_same_live_key() {
    // 启动回退后保存回默认键:库值与生效值不同,但该键正是当前生效键 -> 只落库
    assert_eq!(plan(Some("ctrl+shift+q"), "ctrl+shift+q", true), (false, None));
    // 落库失败后重试同一键:同上,不再注册(否则会误报"已被占用")
    assert_eq!(plan(Some("alt+shift+l"), "alt+shift+l", true), (false, None));
    // 生效值说已生效但实际未注册:注册以自愈
    assert_eq!(plan(Some("ctrl+shift+q"), "ctrl+shift+q", false), (true, None));
    // 换键:注册新键,成功后注销旧键
    assert_eq!(
        plan(Some("alt+shift+l"), "ctrl+shift+q", false),
        (true, Some("alt+shift+l".to_string()))
    );
    // 启动两次尝试都失败(无生效值):直接注册
    assert_eq!(plan(None, "ctrl+shift+q", false), (true, None));
}

#[test]
fn live_hotkey_state_round_trip() {
    let live = LiveHotkey::default();
    assert_eq!(live.get(), None);
    live.set(Some("ctrl+shift+q"));
    assert_eq!(live.get().as_deref(), Some("ctrl+shift+q"));
    live.set(None);
    assert_eq!(live.get(), None);
}

/// 插件认识的别名(库里若有历史写法不至于被判非法)
#[test]
fn modifier_aliases_from_plugin_are_accepted() {
    assert_eq!(check("cmdorctrl+q").as_deref(), Ok("ctrl+q"));
    assert_eq!(check("commandorctrl+q").as_deref(), Ok("ctrl+q"));
    assert_eq!(check("win+shift+q").as_deref(), Ok("shift+super+q"));
}
