//! 输入栏唤起快捷键:运行时生效值真源、注册/注销与启动回退(H1/H4/H5)。
//! 纯校验与规范化在 crate::hotkey_spec(此处 re-export,调用方仍走 hotkey::*);
//! 切换语义仍在 windowing::input::toggle,本模块不碰。
use crate::db::{repos, Db};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

pub use crate::hotkey_spec::{attempts, check, effective, parse, plan, DEFAULT_HOTKEY};

/// 设置键:存规范化后的加速键字符串
pub const HOTKEY_KEY: &str = "input_hotkey";

/// 运行时**实际生效**的快捷键(单一真源)。库里的值可能与生效值不同(启动回退、
/// 落库失败),所以界面显示与改键决策都必须读这里,而不是读库。
#[derive(Default)]
pub struct LiveHotkey(Mutex<Option<String>>);

impl LiveHotkey {
    pub fn set(&self, value: Option<&str>) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = value.map(str::to_string);
        }
    }

    pub fn get(&self) -> Option<String> {
        self.0.lock().ok().and_then(|slot| slot.clone())
    }
}

/// 读运行时生效值(None = 当前没有热键在生效)
pub fn live(app: &AppHandle) -> Option<String> {
    app.try_state::<LiveHotkey>().and_then(|s| s.get())
}

/// 写运行时生效值(注册成功后由 apply 与改键命令调用)
pub fn set_live(app: &AppHandle, value: Option<&str>) {
    if let Some(state) = app.try_state::<LiveHotkey>() {
        state.set(value);
    }
}

/// 读库里的原始设置值(未规范化);库不可用时按缺失处理
pub fn stored(app: &AppHandle) -> Option<String> {
    let db = app.try_state::<Db>()?;
    let conn = db.0.lock().ok()?;
    repos::settings::get(&conn, HOTKEY_KEY).ok().flatten()
}

/// 注册快捷键;失败返回中文原因(不触碰其它已注册键,注销旧键的顺序由调用方保证,H4)
pub fn register(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    app.global_shortcut().register(accelerator).map_err(|e| {
        let text = e.to_string();
        if text.to_ascii_lowercase().contains("already registered") {
            // 插件的英文 Debug 对用户无意义,这里换成可行动的中文
            format!("快捷键 {accelerator} 已被占用(可能被本程序或其他程序注册),请换一个组合")
        } else {
            format!("快捷键 {accelerator} 注册失败:{text}")
        }
    })
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
            Ok(()) => {
                set_live(app, Some(&candidate));
                return Ok(candidate);
            }
            Err(e) => last = e,
        }
    }
    set_live(app, None);
    Err(last)
}

#[cfg(test)]
#[path = "hotkey_tests.rs"]
mod hotkey_tests;
