//! 快捷键的纯逻辑:校验、规范化、回退与改键决策(不碰 AppHandle,便于单测)。
//! 决策见 docs/superpowers/specs/2026-09-17-input-hotkey-design.md 的 H1-H3:
//! 库里一律存**规范化**后的加速键字符串(如 ctrl+shift+q),缺失/非法一律回退默认键,
//! 绝不猜测用户意图、也不改写库。注册/注销等带 AppHandle 的部分在 crate::hotkey。
use tauri_plugin_global_shortcut::{Code, Shortcut};

/// 规范化后的修饰键顺序(H3)
pub const MOD_ORDER: [&str; 4] = ["ctrl", "alt", "shift", "super"];

/// 默认快捷键(与改造前写死的值一致)
pub const DEFAULT_HOTKEY: &str = "ctrl+shift+q";

/// 修饰键别名 -> 规范名(只收插件解析器认识的名字,外加 win/meta 这类惯用写法)
fn modifier_of(token: &str) -> Option<&'static str> {
    match token.to_ascii_lowercase().as_str() {
        "ctrl" | "control" => Some("ctrl"),
        // 插件在非 mac 平台把 cmdorctrl 系列映射为 Ctrl,这里同样归一
        "cmdorctrl" | "commandorctrl" | "cmdorl" => Some("ctrl"),
        "alt" | "option" => Some("alt"),
        "shift" => Some("shift"),
        "super" | "cmd" | "command" | "meta" | "win" => Some("super"),
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

/// 改键决策(纯函数,便于测试):
/// - `needs_register`:是否需要注册新键。**已经确认注册中的同名键必须跳过注册** ——
///   Windows 下对同进程已注册的同一键再注册只会报"已被占用",跳过才能让
///   "启动回退后保存回默认键""落库失败后重试同一键"这两条路径走通;
/// - `drop_old`:注册成功后需要注销的旧键(新旧相同时为 None,避免把自己注销掉)。
pub fn plan(old: Option<&str>, new: &str, new_registered: bool) -> (bool, Option<String>) {
    let needs_register = old != Some(new) || !new_registered;
    let drop_old = old.filter(|prev| *prev != new).map(str::to_string);
    (needs_register, drop_old)
}
