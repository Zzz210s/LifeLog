// 开机启动命令:执行者是 tauri-plugin-autostart,前端不直接依赖它的命令与权限,统一走这里。
// 关键点:插件的 enable()/disable() 返回 Ok 并不等于注册表真的改了(可能被安全软件拦下),
// 所以每次写后都回读真实状态校验,不一致时把错误交给界面显示「需要修复」。
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// 注册表里的真实开机启动状态(界面上的"期望值"存在设置键 input_autostart 里)
#[derive(Serialize)]
pub struct AutostartStatus {
    pub enabled: bool,
}

/// 写注册表前先做的事:期望值 == 当前真实值就是稳定态,不需要写
/// (关闭自启而 Run 值本就不存在时若硬调 disable(),auto-launch 的 delete_value
/// 会对不存在的值返回 io NotFound,界面于是弹「关闭开机启动失败」的假错误,
/// 而库与注册表其实都已是期望的 off 态)。
#[derive(Debug, PartialEq, Eq)]
enum AutostartWrite {
    None,
    Enable,
    Disable,
}

fn plan_write(wanted: bool, current: bool) -> AutostartWrite {
    if wanted == current {
        AutostartWrite::None
    } else if wanted {
        AutostartWrite::Enable
    } else {
        AutostartWrite::Disable
    }
}

#[tauri::command]
pub fn get_autostart_status(app: AppHandle) -> Result<AutostartStatus, String> {
    let enabled = app
        .autolaunch()
        .is_enabled()
        .map_err(|e| format!("读取开机启动状态失败: {e}"))?;
    Ok(AutostartStatus { enabled })
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let current = manager
        .is_enabled()
        .map_err(|e| format!("读取开机启动状态失败: {e}"))?;
    let write = match plan_write(enabled, current) {
        AutostartWrite::None => Ok(()), // 幂等:已是期望态,不动注册表
        AutostartWrite::Enable => manager.enable(),
        AutostartWrite::Disable => manager.disable(),
    };
    if let Err(e) = write {
        // 写失败也可能是「目标态已达成」(例如并发下标被清掉):回读一致即按幂等成功,
        // 只有回读仍不一致才把错误交给界面。
        if manager.is_enabled().is_ok_and(|actual| actual == enabled) {
            return Ok(());
        }
        return Err(format!(
            "{}开机启动失败: {e}",
            if enabled { "启用" } else { "关闭" }
        ));
    }
    let actual = manager
        .is_enabled()
        .map_err(|e| format!("回读开机启动状态失败: {e}"))?;
    if actual != enabled {
        return Err(format!(
            "开机启动未生效:系统当前为{}",
            if actual { "已启用" } else { "已关闭" }
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_write_when_registry_already_matches() {
        // W1:Run 值不存在 + 期望关闭 -> 不写注册表(否则 disable 报 NotFound 被当成失败)
        assert_eq!(plan_write(false, false), AutostartWrite::None);
        assert_eq!(plan_write(true, true), AutostartWrite::None);
    }

    #[test]
    fn writes_only_on_difference() {
        assert_eq!(plan_write(true, false), AutostartWrite::Enable);
        assert_eq!(plan_write(false, true), AutostartWrite::Disable);
    }
}
