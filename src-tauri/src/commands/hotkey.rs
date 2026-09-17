//! 快捷键设置命令:校验 -> (必要时)注册新键 -> 落库 -> 注销旧键(H4)。
//! 失败时保证「当前可用的键不被弄丢」:非法组合连键都不碰;注册失败(被占用)保留旧键;
//! 落库失败时新键已生效、旧键**就地注销**(不留孤儿),并明确告知重启后的回退结果。
//! 改键决策读**运行时生效值**(hotkey::live)而不是库值:启动回退后库值与生效值可能不同。
use crate::db::{repos, Db};
use crate::hotkey;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// 读运行时实际生效的快捷键(None = 当前没有热键在生效)。
/// 界面显示走这里:它与真实注册状态一致,而库值可能因启动回退而滞后。
#[tauri::command]
pub fn get_input_hotkey(app: AppHandle) -> Option<String> {
    hotkey::live(&app)
}

/// 设置输入栏唤起快捷键,返回规范化后的生效值
#[tauri::command]
pub fn set_input_hotkey(app: AppHandle, accelerator: String) -> Result<String, String> {
    let new = hotkey::check(&accelerator)?;
    let old = hotkey::live(&app);
    let registered = app.global_shortcut().is_registered(new.as_str());
    let (needs_register, drop_old) = hotkey::plan(old.as_deref(), &new, registered);
    if needs_register {
        // 已被本进程注册的同名键先让位:Windows 下对同进程重复注册只会报"已被占用"
        if registered {
            hotkey::unregister(&app, &new);
        }
        hotkey::register(&app, &new)?;
        hotkey::set_live(&app, Some(&new));
    }
    // 旧键的注销只写一次:不论落库成败都必须做 —— 失败时它已不在生效值真源里,
    // 留着就会成为“仍注册、却谁也认不出”的孤儿(两个键同时唤醒且界面只显示一个)
    let saved = persist(&app, &new);
    if let Some(prev) = drop_old.as_deref() {
        hotkey::unregister(&app, prev);
    }
    saved.map_err(|e| {
        // 重启后会回到库里的值(可能又是默认键),不做无依据的回退断言
        let restart = hotkey::effective(hotkey::stored(&app).as_deref());
        format!("快捷键 {new} 已生效,但保存失败(重启后将回到 {restart}):{e}")
    })?;
    Ok(new)
}

fn persist(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::settings::set(&conn, hotkey::HOTKEY_KEY, accelerator).map_err(|e| e.to_string())
}
