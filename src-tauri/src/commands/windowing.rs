use crate::windowing;
use crate::windowing::quick_scale;
use tauri::AppHandle;

#[tauri::command]
pub fn hide_quick_window(app: AppHandle) -> Result<(), String> {
    windowing::quick::hide(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_quick_size(app: AppHandle, width: u32, height: u32) -> Result<(), String> {
    quick_scale::apply_size(&app, quick_scale::clamp_width(width), height)
}

/// 缩放:尺寸 = 基础尺寸 x 系数(工作区收口),并把系数落到 webview zoom
#[tauri::command]
pub fn set_quick_scale(app: AppHandle, zoom: f32) -> Result<(), String> {
    quick_scale::apply_scale(&app, zoom as f64)
}

/// 进入拖动会话:页面在 startDragging 之前调用,让失焦自动隐藏在拖动期间跳过 Focused(false)
#[tauri::command]
pub fn begin_quick_drag() {
    windowing::quick::begin_drag_session();
}

/// 结束拖动会话(页面 mouseup 调用;Rust 侧还会用「最后一次 Moved + 空闲期」自动退出兜底)
#[tauri::command]
pub fn end_quick_drag() {
    windowing::quick::end_drag_session();
}
