//! 应用内快捷键(命令面板 / 快速打开笔记)的纯逻辑:用途元数据、语法校验与冲突判定。
//!
//! 与系统级热键(`crate::hotkey`)的区别:这两个**不注册系统热键**,只落 settings 供主窗
//! keydown 匹配,所以没有「注册失败」这条路径;但落库值仍必须经 `hotkey_spec` 规范化
//! (T3 审查 Important-2:TS 的形态预检会放行 `ctrl+zzz` 这类 Rust 不认的键名,直接落库就是死键)。
use crate::hotkey_spec;

/// 一个应用内快捷键用途的元数据;kind / setting_key / default 与前端 `APP_HOTKEY_KEYS`
/// `DEFAULT_APP_HOTKEYS` 同源(设计 §3.6)
#[derive(Debug)]
pub struct Kind {
    pub kind: &'static str,
    pub label: &'static str,
    pub setting_key: &'static str,
    pub default: &'static str,
}

pub const KINDS: [Kind; 2] = [
    Kind {
        kind: "palette",
        label: "命令面板",
        setting_key: "main_palette_hotkey",
        default: "ctrl+shift+p",
    },
    Kind {
        kind: "quickOpen",
        label: "快速打开笔记",
        setting_key: "main_quick_open_hotkey",
        default: "ctrl+p",
    },
];

/// 「清除自定义」的存储值:读取侧(前端 effectiveAppHotkey)见到空/非法一律回退默认键
pub const CLEARED: &str = "";

/// 用途 -> 元数据;未知用途给中文原因(前端传错 kind 不静默)
pub fn of(kind: &str) -> Result<&'static Kind, String> {
    KINDS
        .iter()
        .find(|k| k.kind == kind)
        .ok_or_else(|| format!("未知的快捷键用途:{kind}"))
}

/// 另一个用途(只有两个;调用方先 `of()` 校验过 kind,不会落空)
pub fn other(kind: &str) -> &'static Kind {
    KINDS.iter().find(|k| k.kind != kind).unwrap_or(&KINDS[0])
}

/// 是否是应用内快捷键的设置键(通用写口 `set_setting` 用它挡住绕过规范化的写入)
pub fn is_setting_key(key: &str) -> bool {
    KINDS.iter().any(|k| k.setting_key == key)
}

/// 某个用途的**生效值**:库值缺失/非法一律回退它自己的默认键(与前端 effectiveAppHotkey 同规则)
pub fn effective(stored: Option<&str>, k: &Kind) -> String {
    stored
        .and_then(hotkey_spec::parse)
        .unwrap_or_else(|| k.default.to_string())
}

/// 冲突判定(纯函数)。`global` 是系统级全局热键的**生效值**,`other_stored` 是另一个应用内键的库值。
/// 两侧都先规范化再比 —— 否则 `Ctrl+Shift+Q` 这种写法会漏判。
/// 另一个键要按**生效值**比:没设置过的那个键运行时用的就是它的默认键,漏判会让两个入口抢同一个键。
pub fn conflict(
    new: &str,
    global: Option<&str>,
    other: &Kind,
    other_stored: Option<&str>,
) -> Option<String> {
    if global.and_then(hotkey_spec::parse).as_deref() == Some(new) {
        return Some(format!(
            "{new} 已被系统级全局快捷键占用(输入栏唤起键),请换一个组合"
        ));
    }
    if effective(other_stored, other) == new {
        return Some(format!("{new} 已被「{}」占用,请换一个组合", other.label));
    }
    None
}

/// 写库前的纯决策:规范化 + 冲突校验。空输入 = 清除自定义(不参与冲突校验)。
pub fn decide(
    kind: &str,
    raw: &str,
    global: Option<&str>,
    other_stored: Option<&str>,
) -> Result<String, String> {
    of(kind)?; // 未知用途先挡(命令层随后还会取元数据)
    if raw.trim().is_empty() {
        return Ok(CLEARED.to_string());
    }
    let normalized = hotkey_spec::check(raw)?;
    match conflict(&normalized, global, other(kind), other_stored) {
        Some(reason) => Err(reason),
        None => Ok(normalized),
    }
}

#[cfg(test)]
#[path = "app_hotkey_tests.rs"]
mod app_hotkey_tests;
