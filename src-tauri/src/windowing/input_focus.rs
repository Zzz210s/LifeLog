//! 输入栏唤起时的焦点行为(用户 2026-10-03 定的口径)。
//!
//! **默认不夺焦点**:唤起输入栏时若把系统前台窗口抢过来,全屏游戏会被踢出画面 ——
//! 而本软件的定位就是"不打扰其他程序"。做法是在 `show()` 之前 `set_focusable(false)`
//! (Windows 上即 `WS_EX_NOACTIVATE`),窗口就不会因 ShowWindow 激活;
//! 用户**主动点一下**输入栏后,由命令 `focus_input_bar` 打开可聚焦并取焦点(`focus_now`)。
//!
//! 设置键 `input_focus_on_show` 为 `true` 时恢复旧行为(唤起即夺焦点,可以马上打字)。
//! 从 input.rs 拆出以守住 200 行上限。

use crate::db::repos;
use crate::db::Db;
use tauri::{AppHandle, Manager, WebviewWindow};

/// 唤起输入栏时是否夺取焦点(设置缺失/非 "true" 一律按不夺)
pub fn steal_on_show(app: &AppHandle) -> bool {
    let db: tauri::State<Db> = app.state();
    let raw = db
        .0
        .lock()
        .ok()
        .and_then(|conn| repos::settings::get(&conn, "input_focus_on_show").ok().flatten());
    raw.map(|v| v == "true").unwrap_or(false)
}

/// 在 show() 之前调用:按开关决定窗口是否可聚焦(不可聚焦 ⇒ show 不激活窗口)
pub fn apply_focusable(w: &WebviewWindow, steal: bool) {
    let _ = w.set_focusable(steal);
}

/// 用户点了输入栏:这时才允许它取焦点。幂等 —— 已经可聚焦且有焦点时再调一次无害。
pub fn focus_now(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("input") {
        let _ = w.set_focusable(true);
        w.set_focus()?;
    }
    Ok(())
}
