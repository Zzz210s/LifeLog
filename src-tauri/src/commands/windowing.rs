use crate::windowing;
use crate::windowing::input_scale;
use tauri::AppHandle;

#[tauri::command]
pub fn hide_input_bar(app: AppHandle) -> Result<(), String> {
    windowing::input::hide(&app).map_err(|e| e.to_string())
}

/// 显示(不切换)输入栏:主窗空库引导用,语义与二次启动一致(show,不把眼前的窗口隐藏)
#[tauri::command]
pub fn show_input_bar(app: AppHandle) -> Result<(), String> {
    windowing::input::show(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_input_size(app: AppHandle, width: u32, height: u32) -> Result<(), String> {
    input_scale::apply_size(&app, input_scale::clamp_width(width), height)
}

/// 带 # 补全建议列表时的窗口高度:只改窗口,不把展开高度写回 input_h(见 apply_size_overlay)
#[tauri::command]
pub fn set_input_size_overlay(app: AppHandle, width: u32, height: u32) -> Result<(), String> {
    windowing::input_overlay::apply_size_overlay(&app, input_scale::clamp_width(width), height)
}

/// 缩放:尺寸 = 基础尺寸 x 系数(工作区收口),并把系数落到 webview zoom
#[tauri::command]
pub fn set_input_scale(app: AppHandle, zoom: f32) -> Result<(), String> {
    input_scale::apply_scale(&app, zoom as f64)
}

/// 进入拖动会话:页面在 startDragging 之前调用,让失焦自动隐藏在拖动期间跳过 Focused(false)
#[tauri::command]
pub fn begin_input_drag() {
    windowing::input::begin_drag_session();
}

/// 取走主窗的「打开后切到设置页」意图(mount 时调用;取走即清空,第二次打开不被切走)
#[tauri::command]
pub fn take_pending_open_settings() -> bool {
    windowing::main_window::take_pending()
}

/// 结束拖动会话(页面 mouseup 调用;Rust 侧还会用「最后一次 Moved + 空闲期」自动退出兜底)
#[tauri::command]
pub fn end_input_drag() {
    windowing::input::end_drag_session();
}
