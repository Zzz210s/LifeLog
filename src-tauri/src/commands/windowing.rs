use crate::windowing;
use crate::windowing::quick_scale;
use tauri::AppHandle;

#[tauri::command]
pub fn hide_quick_window(app: AppHandle) -> Result<(), String> {
    windowing::quick::hide(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_quick_pin(app: AppHandle) -> Result<bool, String> {
    windowing::quick::toggle_pin(&app)
}

#[tauri::command]
pub fn set_quick_zoom(app: AppHandle, zoom: f32) -> Result<(), String> {
    windowing::quick::set_zoom(&app, zoom)
}

#[tauri::command]
pub fn set_quick_size(app: AppHandle, width: u32, height: u32) -> Result<(), String> {
    quick_scale::apply_size(&app, quick_scale::clamp_width(width), height)
}
