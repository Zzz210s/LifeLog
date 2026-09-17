//! 快捷键设置命令:校验 -> 注册新键 -> 落库 -> 才注销旧键(H4)。
//! 任一步失败都保证「当前可用的键不被弄丢」:非法组合连键都不碰;
//! 注册失败(被占用)保留旧键;落库失败则新旧键同时可用并明确告知重启后的回退结果。
use crate::db::{repos, Db};
use crate::hotkey;
use tauri::{AppHandle, Manager, State};

/// 设置输入栏唤起快捷键,返回规范化后的生效值
#[tauri::command]
pub fn set_input_hotkey(app: AppHandle, accelerator: String) -> Result<String, String> {
    let new = hotkey::check(&accelerator)?;
    let old = hotkey::effective(hotkey::stored(&app).as_deref());
    if new != old {
        hotkey::register(&app, &new)?;
    }
    if let Err(e) = persist(&app, &new) {
        // 已生效但未保存:旧键此刻仍在,重启后会回到 old,不做无依据的回退断言
        return Err(format!("快捷键已生效,但保存失败(重启后将回到 {old}):{e}"));
    }
    if new != old {
        hotkey::unregister(&app, &old);
    }
    Ok(new)
}

fn persist(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::settings::set(&conn, hotkey::HOTKEY_KEY, accelerator).map_err(|e| e.to_string())
}
