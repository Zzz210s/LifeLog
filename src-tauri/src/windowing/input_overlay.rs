//! 输入栏「# 补全建议列表展开」时的窗口让位逻辑(从 input_scale 拆出以守 200 行上限)。
//! 展开时窗口会变高:若下/右边缘会伸出工作区,就把窗口挪进来;列表关掉再还原。
//! 位移**绝不落库** —— 那是"给列表让位"的临时位移,落库会固化成用户位置。
//! 窗口尺寸本身由 input_height 换算(缩放无关的基础逻辑高度 -> 物理尺寸),本模块只管位移。

use std::sync::Mutex;
use tauri::{PhysicalPosition, WebviewWindow};

/// 展开建议列表时窗口会变高:若下边缘(或右边缘)会伸出工作区,算出要移动到的位置。
/// 只移动显示位置,**不写回设置** —— 这是"给列表让位"的临时位移,关掉列表要还原。
/// work = (x, y, w, h) 工作区矩形(物理像素);size = 窗口尺寸;pos = 当前窗口位置。
/// 保留 EDGE_MARGIN 的边距,避免贴着任务栏/屏幕边缘。
pub const OVERLAY_EDGE_MARGIN: i32 = 8;

pub fn overlay_position(
    work: (i32, i32, u32, u32),
    size: (u32, u32),
    pos: (i32, i32),
) -> (i32, i32) {
    let (wx, wy, ww, wh) = work;
    let (sw, sh) = (size.0 as i32, size.1 as i32);
    let bottom_limit = wy + wh as i32 - OVERLAY_EDGE_MARGIN;
    let right_limit = wx + ww as i32 - OVERLAY_EDGE_MARGIN;
    let y = if pos.1 + sh > bottom_limit {
        (bottom_limit - sh).max(wy)
    } else {
        pos.1
    };
    let x = if pos.0 + sw > right_limit {
        (right_limit - sw).max(wx)
    } else {
        pos.0
    };
    (x, y)
}
/// 建议列表展开前被临时挪动的窗口位置;关掉列表时还原。
/// 只活在进程内:位置绝不落库(落库会把"为列表让位"固化成用户位置)。
static OVERLAY_RESTORE: Mutex<Option<(i32, i32)>> = Mutex::new(None);

/// 记住当前位置(仅第一次),若展开后会伸出工作区就把窗口挪进来(纯显示位移)
pub fn shift_for_overlay(win: &WebviewWindow, phys: (u32, u32)) {
    let (Ok(pos), Ok(Some(mon))) = (win.outer_position(), win.current_monitor()) else {
        return;
    };
    let area = mon.work_area();
    let work = (area.position.x, area.position.y, area.size.width, area.size.height);
    let (x, y) = overlay_position(work, phys, (pos.x, pos.y));
    if x == pos.x && y == pos.y {
        return;
    }
    let mut slot = OVERLAY_RESTORE.lock().unwrap_or_else(|e| e.into_inner());
    if slot.is_none() {
        *slot = Some((pos.x, pos.y));
    }
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

/// 还原被 shift_for_overlay 挪动的窗口位置(没有挪过则什么都不做;列表关闭时由 input_height::apply_height 调用)
pub fn restore(win: &WebviewWindow) {
    let saved = OVERLAY_RESTORE.lock().unwrap_or_else(|e| e.into_inner()).take();
    let Some((x, y)) = saved else {
        return;
    };
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

#[cfg(test)]
#[path = "input_overlay_tests.rs"]
mod input_overlay_tests;
