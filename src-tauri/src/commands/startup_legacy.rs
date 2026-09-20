// 自启项的「改名兜底」:Run 值名取 package_info().name(即 tauri.conf.json 的 productName),
// 于是每次改显示名,旧名下的注册项都会变成孤儿 —— 应用读不到它,设置页会把「已启用」显示成
// 「需要修复」,用户得手动重开一次自启(2026-09-20 把 productName 从 LifeLog 改成「拾枝」时就
// 是本机手工改的键名)。这里在启动时把历代 productName 下的项改名到当前名下,让升级自愈。
// 只在「当前名下没有值」时动手;采用是复制值 + 删旧值(等价改名),任一失败都只影响本次兜底。
const RUN_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";

/// 历代 productName(改名史:app-lifelog -> LifeLog -> 拾枝),按新到旧排列
pub const LEGACY_ENTRY_NAMES: &[&str] = &["LifeLog", "app-lifelog"];

/// 纯函数:当前名下没有值、而某个旧名下有时,该采用哪个旧名(按 LEGACY_ENTRY_NAMES 顺序取第一个)。
/// 当前名下已有值 -> 不采用任何旧名(调用方据此提前返回,不碰注册表)。
pub fn pick_legacy_entry<'a>(current: &str, existing: &'a [String]) -> Option<&'a str> {
    if existing.iter().any(|n| n == current) {
        return None;
    }
    LEGACY_ENTRY_NAMES
        .iter()
        .filter(|name| **name != current)
        .find(|name| existing.iter().any(|n| n == *name))
        .and_then(|name| existing.iter().find(|n| n == name).map(String::as_str))
}

/// 启动时的兜底改名。返回采用的旧名(没动就是 None)。
/// 失败不阻断启动:自启状态仍可从设置页「修复」重写,日志留痕即可。
#[cfg(windows)]
pub fn adopt_legacy_entry(current: &str) -> Result<Option<String>, String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(RUN_KEY, KEY_READ | KEY_WRITE)
        .map_err(|e| format!("打开注册表 Run 键失败: {e}"))?;
    if key.get_value::<String, _>(current).is_ok() {
        return Ok(None); // 当前名下已有值:不碰
    }
    let names: Vec<String> = key
        .enum_values()
        .filter_map(|r| r.ok().map(|(name, _)| name))
        .collect();
    let Some(legacy) = pick_legacy_entry(current, &names) else {
        return Ok(None);
    };
    let value: String = key
        .get_value(legacy)
        .map_err(|e| format!("读取旧自启值 {legacy} 失败: {e}"))?;
    key.set_value(current, &value)
        .map_err(|e| format!("写入自启值 {current} 失败: {e}"))?;
    key.delete_value(legacy)
        .map_err(|e| format!("删除旧自启值 {legacy} 失败: {e}"))?;
    Ok(Some(legacy.to_string()))
}

/// 非 Windows 没有注册表 Run 项(本项目只发布 Windows 构建):什么都不做
#[cfg(not(windows))]
pub fn adopt_legacy_entry(_current: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(test)]
#[path = "startup_legacy_tests.rs"]
mod startup_legacy_tests;
