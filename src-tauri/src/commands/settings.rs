use crate::db::repos;
use crate::db::Db;
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub fn get_setting(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::settings::get(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    // 快捷键有唯一写路径 set_input_hotkey(先注册后落库),通用写口必须挡住它:
    // 否则绕过注册直接改库,会出现"库里说 ctrl+shift+q、实际生效的是别的键"
    if key == crate::hotkey::HOTKEY_KEY {
        return Err("快捷键请用 set_input_hotkey 设置(需要先注册成功再保存)".to_string());
    }
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::settings::set(&conn, &key, &value).map_err(|e| e.to_string())
}

/// 时间标签模板校验(设置页即时提示用):返回中文原因,合法时 Ok。
/// 与创建路径共用同一实现(见 timetag::validate_template),不存在第二套规则。
#[tauri::command]
pub fn validate_time_tag_template(template: String) -> Result<(), String> {
    crate::timetag::validate_template(&template)
}

/// 三档锁定一次性写库:单个事务,要么三键全部生效、要么全不生效
/// (避免解锁只写了一半,界面与库反向偏离)
#[tauri::command]
pub fn set_input_locks(
    app: AppHandle,
    lock_move: bool,
    lock_close: bool,
    lock_content: bool,
) -> Result<(), String> {
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (key, locked) in [
        ("input_lock_move", lock_move),
        ("input_lock_close", lock_close),
        ("input_lock_content", lock_content),
    ] {
        repos::settings::set(&tx, key, if locked { "true" } else { "false" })
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    // 广播与其他写路径一致:输入栏点锁图标解锁后,主窗设置页能感知到这三档已变。
    // 发送失败只静默(事件是加速通道,读侧仍会自己重读设置)。
    let _ = app.emit("input-settings-changed", ());
    Ok(())
}
