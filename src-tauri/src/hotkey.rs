//! 输入栏唤起快捷键:校验/规范化(纯逻辑)、注册与启动回退。
//! 决策见 docs/superpowers/specs/2026-09-17-input-hotkey-design.md 的 H1-H5:
//! 库里一律存**规范化**后的加速键字符串(如 ctrl+shift+q),缺失/非法一律回退默认键,
//! 且绝不猜测用户意图、不改写库。切换语义仍在 windowing::input::toggle,本模块不碰。

use crate::windowing::input_geom;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut};

/// 设置键:存规范化后的加速键字符串
pub const HOTKEY_KEY: &str = "input_hotkey";
/// 默认快捷键(与改造前写死的值一致)
pub const DEFAULT_HOTKEY: &str = "ctrl+shift+q";

/// 规范化后的修饰键顺序(H3)
const MOD_ORDER: [&str; 4] = ["ctrl", "alt", "shift", "super"];

/// 修饰键别名 -> 规范名(只收插件解析器认识的名字,外加 meta)
fn modifier_of(token: &str) -> Option<&'static str> {
    match token.to_ascii_lowercase().as_str() {
        "ctrl" | "control" => Some("ctrl"),
        "alt" | "option" => Some("alt"),
        "shift" => Some("shift"),
        "super" | "cmd" | "command" | "meta" => Some("super"),
        _ => None,
    }
}

/// 主键规范名:字母/数字用裸字符(q / 5),其余用插件规范名的小写(space / f2 / arrowup)。
/// 输出一定能被插件解析器再解析(见 hotkey_tests 的幂等往返用例)。
fn canonical_key(code: Code) -> String {
    let name = code.to_string();
    if let Some(rest) = name.strip_prefix("Key") {
        return rest.to_ascii_lowercase();
    }
    name.strip_prefix("Digit")
        .map_or_else(|| name.to_ascii_lowercase(), str::to_string)
}

/// 单个按键是否 F1-F24(单键组合只允许功能键,H2)
fn is_function_key(code: Code) -> bool {
    code.to_string()
        .strip_prefix('F')
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (1..=24).contains(&n))
}

/// 校验并规范化按键序列,非法返回中文原因(H2/H3)
pub fn validate(parts: &[String]) -> Result<String, String> {
    let tokens: Vec<&str> = parts
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();
    if tokens.is_empty() {
        return Err("快捷键不能为空".to_string());
    }
    if tokens.len() > 3 {
        return Err("最多支持 3 个键的组合".to_string());
    }
    let mut mods: Vec<&'static str> = Vec::new();
    let mut keys: Vec<Code> = Vec::new();
    for token in &tokens {
        match modifier_of(token) {
            Some(m) => {
                if !mods.contains(&m) {
                    mods.push(m);
                }
            }
            None => match token.parse::<Shortcut>() {
                Ok(shortcut) => keys.push(shortcut.key),
                Err(_) => return Err(format!("无法识别的按键:{token}")),
            },
        }
    }
    if keys.is_empty() {
        return Err("修饰键之外还需要一个主键(如 Q 或 F5)".to_string());
    }
    if keys.len() > 1 {
        return Err("只能有一个主键".to_string());
    }
    let key = keys[0];
    if tokens.len() == 1 && !is_function_key(key) {
        return Err("单个按键只允许 F1-F24(避免占用全系统按键)".to_string());
    }
    let mut out = String::new();
    for m in MOD_ORDER {
        if mods.contains(&m) {
            out.push_str(m);
            out.push('+');
        }
    }
    out.push_str(&canonical_key(key));
    Ok(out)
}

/// 校验并规范化(规格要求的纯入口);非法返回 None
pub fn normalize(parts: &[String]) -> Option<String> {
    validate(parts).ok()
}

/// 加速键字符串 -> 键名片段
fn split(raw: &str) -> Vec<String> {
    raw.split('+').map(str::to_string).collect()
}

/// 加速键字符串 -> 规范化;非法返回中文原因
pub fn check(raw: &str) -> Result<String, String> {
    validate(&split(raw))
}

/// 库里的字符串 -> 规范化(非法返回 None)
pub fn parse(raw: &str) -> Option<String> {
    normalize(&split(raw))
}

/// 读库值 -> 规范化,缺失/非法一律回退默认(H1)
pub fn effective(raw: Option<&str>) -> String {
    raw.and_then(parse)
        .unwrap_or_else(|| DEFAULT_HOTKEY.to_string())
}

/// 启动注册的尝试顺序:库值(规范化)优先,失败回退默认键(两者相同时不重复尝试)
pub fn attempts(raw: Option<&str>) -> Vec<String> {
    let want = effective(raw);
    if want == DEFAULT_HOTKEY {
        vec![want]
    } else {
        vec![want, DEFAULT_HOTKEY.to_string()]
    }
}

/// 读库里的原始设置值(未规范化)
pub fn stored(app: &AppHandle) -> Option<String> {
    input_geom::get_str(app, HOTKEY_KEY)
}

/// 注册快捷键;失败返回中文原因(不触碰其它已注册键,注销旧键的顺序由调用方保证,H4)
pub fn register(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    app.global_shortcut()
        .register(accelerator)
        .map_err(|e| format!("快捷键 {accelerator} 注册失败,可能已被其他程序占用:{e}"))
}

/// 注销快捷键(尽力而为):失败只记日志 —— 旧键没注销最多两个键都能唤起,不阻断用户操作
pub fn unregister(app: &AppHandle, accelerator: &str) {
    if let Err(e) = app.global_shortcut().unregister(accelerator) {
        eprintln!("快捷键 {accelerator} 注销失败(不影响新键,仅可能两个键都能唤起):{e}");
    }
}

/// 启动注册(H5):按 attempts 顺序注册,返回最终生效值;全部失败返回中文原因(调用方只记日志)。
/// 注册前先注销同名键:重复调用或重载时,插件对已注册的同名键会直接报错。
pub fn apply(app: &AppHandle, raw: Option<&str>) -> Result<String, String> {
    if raw.is_some_and(|v| parse(v).is_none()) {
        eprintln!("设置里的快捷键无效,已回退默认键 {DEFAULT_HOTKEY}");
    }
    let mut last = String::new();
    for candidate in attempts(raw) {
        if app.global_shortcut().is_registered(candidate.as_str()) {
            unregister(app, &candidate);
        }
        match register(app, &candidate) {
            Ok(()) => return Ok(candidate),
            Err(e) => last = e,
        }
    }
    Err(last)
}

#[cfg(test)]
#[path = "hotkey_tests.rs"]
mod hotkey_tests;
