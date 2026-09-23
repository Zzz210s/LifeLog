//! 应用内快捷键(命令面板 / 快速打开笔记)的**唯一写路径**:规范化 + 冲突检查 + 落库。
//!
//! 与系统级热键不同,这两个不注册系统热键,所以没有「注册失败」分支;但通用写口
//! `set_setting` 对这两个键直接拒绝 —— 绕过这里就等于把未经 Rust 规范化的值写进库
//! (T3 审查 Important-2:`ctrl+zzz` 这类值落库后永远匹配不上,是死键)。
//! 冲突的参照物取**生效值**:系统级取运行时生效值,另一个应用内键取其库值(缺失/非法即它的默认键)。
use crate::app_hotkey;
use crate::db::{repos, Db};
use crate::hotkey;
use tauri::{AppHandle, Manager, State};

/// 写一个应用内快捷键,返回规范化后的值。`accelerator` 传空串 = 清除自定义。
/// 失败给中文原因(语法非法 / 与系统级键冲突 / 与另一个应用内键冲突),**不落库**、旧键保持可用。
#[tauri::command]
pub fn set_app_hotkey(
    app: AppHandle,
    kind: String,
    accelerator: String,
) -> Result<String, String> {
    let me = app_hotkey::of(&kind)?;
    let other = app_hotkey::other(&kind);
    let other_stored = stored(&app, other.setting_key);
    let global = hotkey::live(&app)
        .or_else(|| Some(hotkey::effective(hotkey::stored(&app).as_deref())));
    let saved = app_hotkey::decide(&kind, &accelerator, global.as_deref(), other_stored.as_deref())?;
    persist(&app, me.setting_key, &saved)?;
    Ok(saved)
}

/// 读另一个应用内键的库值(尽力而为:读不到按「未设置」处理,与前端读取口径一致)
fn stored(app: &AppHandle, key: &str) -> Option<String> {
    let db = app.try_state::<Db>()?;
    let conn = db.0.lock().ok()?;
    repos::settings::get(&conn, key).ok().flatten()
}

fn persist(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::settings::set(&conn, key, value).map_err(|e| e.to_string())
}
