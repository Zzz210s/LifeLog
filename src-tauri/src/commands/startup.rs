// 开机启动命令:执行者是 tauri-plugin-autostart,前端不直接依赖它的命令与权限,统一走这里。
// 关键点一:插件的 enable()/disable() 返回 Ok 并不等于注册表真的改了(可能被安全软件拦下),
// 所以每次写后都回读真实状态校验,不一致时把错误交给界面显示「需要修复」。
// 关键点二:决策输入不只是一个布尔值。Run 值里的**可执行文件路径**可能指向旧安装位置
// (本机从 C 盘迁到 E 盘的残留、dev 调试路径)或被任务管理器改写 —— 此时 is_enabled() 仍为
// true,只比布尔值就会判定「无需写」,「修复」按钮静默 no-op,错误永远修不掉。
// 故真实状态读三项:值是否存在、系统是否认作生效、路径是否就是当前进程路径;
// 路径不一致同样判定为需要重写(plan_write 的 Rewrite 就是「强制重写」路径)。
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// Run 值名:插件的 app_name 取 package_info().name(即 tauri.conf.json 的 productName)
fn entry_name(app: &AppHandle) -> String {
    app.package_info().name.clone()
}

/// 读 Run 值的原始字符串(形如 `E:\path\app-lifelog.exe --minimized`)。
/// None = 值不存在;Some("") = 值存在但读不出路径(值类型异常等),按「需要重写」处理,
/// 不让整个状态读取失败 —— 否则界面连开关状态都显示不出来。
#[cfg(windows)]
fn read_run_value(app: &AppHandle) -> Result<Option<String>, String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;
    /// auto-launch 在 Windows 上写的就是这个键(见 auto-launch/src/windows.rs)
    const RUN_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(RUN_KEY, KEY_READ)
        .map_err(|e| format!("打开注册表 Run 键失败: {e}"))?;
    match key.get_value::<String, _>(&entry_name(app)) {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Ok(Some(String::new())),
    }
}

/// 非 Windows 没有注册表 Run 项(本项目只发布 Windows 构建):按「不存在」处理
#[cfg(not(windows))]
fn read_run_value(_app: &AppHandle) -> Result<Option<String>, String> {
    Ok(None)
}

/// 注册表 Run 项的真实状态(全部来自系统读数,不是库里的期望值)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunState {
    /// Run 值是否存在(不存在 = 从未注册)
    pub exists: bool,
    /// 系统是否认作已生效(值存在且未被任务管理器禁用)
    pub enabled: bool,
    /// 值里的可执行文件路径是否就是当前进程路径
    pub path_ok: bool,
}

/// 比值里的第一段(可执行文件路径)与当前进程路径,大小写不敏感。
/// auto-launch 不写引号,格式是 `{path} {args}`(本应用 args 只有 --minimized);
/// 手工或安装器写过的值可能带引号,一并去掉。
fn path_matches(raw: &str, current: &str) -> bool {
    let head = raw.split(" --").next().unwrap_or(raw).trim().trim_matches('"');
    head.eq_ignore_ascii_case(current)
}

fn read_run_state(app: &AppHandle) -> Result<RunState, String> {
    let enabled = app
        .autolaunch()
        .is_enabled()
        .map_err(|e| format!("读取开机启动状态失败: {e}"))?;
    let raw = read_run_value(app)?;
    let current = std::env::current_exe()
        .map(|p| p.display().to_string())
        .map_err(|e| format!("读取当前可执行文件路径失败: {e}"))?;
    Ok(RunState {
        exists: raw.is_some(),
        enabled,
        path_ok: raw.as_deref().is_some_and(|v| path_matches(v, &current)),
    })
}

/// 写注册表的意图(纯决策,见 plan_write 的用例表)
#[derive(Debug, PartialEq, Eq)]
enum AutostartWrite {
    None,
    /// 写 Run 值 = 修复:值缺失、被任务管理器禁用,或路径指向旧位置/被外部改写
    Rewrite,
    Disable,
}

/// 纯函数:期望值 + 系统真实状态 -> 是否需要写注册表
/// (关闭而 Run 值本就不存在时若硬调 disable(),auto-launch 的 delete_value 会对不存在的值
/// 返回 io NotFound,界面于是弹「关闭开机启动失败」的假错误,而库与注册表其实都已是期望的 off 态)
fn plan_write(wanted: bool, state: RunState) -> AutostartWrite {
    if wanted {
        if state.enabled && state.path_ok {
            AutostartWrite::None
        } else {
            AutostartWrite::Rewrite
        }
    } else if state.exists {
        AutostartWrite::Disable
    } else {
        AutostartWrite::None
    }
}

/// 注册表的真实自启状态:界面的「期望值」在设置键 input_autostart 里,两者不一致显示「需要修复」
#[derive(Serialize)]
pub struct AutostartStatus {
    pub enabled: bool,
    /// 路径已失效(换了安装位置)时界面同样提示「需要修复」,点修复即触发 Rewrite
    pub path_ok: bool,
}

#[tauri::command]
pub fn get_autostart_status(app: AppHandle) -> Result<AutostartStatus, String> {
    let state = read_run_state(&app)?;
    Ok(AutostartStatus { enabled: state.enabled, path_ok: state.path_ok })
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let state = read_run_state(&app)?;
    let write = match plan_write(enabled, state) {
        AutostartWrite::None => Ok(()), // 幂等:已是期望态,不动注册表
        AutostartWrite::Rewrite => manager.enable(),
        AutostartWrite::Disable => manager.disable(),
    };
    if let Err(e) = write {
        // 写失败也可能是「目标态已达成」(例如并发下标被清掉):回读一致即按幂等成功,
        // 只有回读仍不一致才把错误交给界面。
        if let Ok(after) = read_run_state(&app) {
            if after.enabled == enabled && (!enabled || after.path_ok) {
                return Ok(());
            }
        }
        return Err(format!(
            "{}开机启动失败: {e}",
            if enabled { "启用" } else { "关闭" }
        ));
    }
    let after = read_run_state(&app)?;
    if after.enabled != enabled {
        return Err(format!(
            "开机启动未生效:系统当前为{}",
            if after.enabled { "已启用" } else { "已关闭" }
        ));
    }
    // 路径是本次修复的重点:值改成当前可执行文件才算真修好(否则下次自启拉起的还是旧位置的程序)
    if enabled && !after.path_ok {
        return Err("开机启动未生效:注册表路径未指向当前程序,请再次点「修复」".into());
    }
    Ok(())
}

#[cfg(test)]
#[path = "startup_tests.rs"]
mod startup_tests;
