use crate::db::repos;
use crate::db::Db;
use crate::windowing::quick_scale;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

/// 拖动会话最近活动时刻(None = 无会话)。两个必需能力组合下不可用:开启「失焦自动隐藏」后
/// 拖动会进入系统移动循环并收到 Focused(false)(2026-09-12 实测:按下开始拖动即发一对
/// Focused(false)/Focused(true)),若照常隐藏,窗口会拖到一半就消失;且该次 hide() 会把
/// 拖动前的旧坐标写成记忆位置。会话期间跳过失焦隐藏。
/// 结束信号不可靠:mouseup 到不了页面(系统模态移动循环把鼠标事件吃掉,实测 up=0),
/// 所以用「最后一次 Moved + DRAG_SESSION_IDLE」作为会话存活期,超时自动退出,
/// 避免标志残留导致失焦隐藏永久失效。
/// 时刻用单调时钟 Instant 而非墙钟(SystemTime):系统时间被回拨(NTP 步进/手动改钟)时,
/// 墙钟差值会恒为 0,会话就一直「活跃」、失焦隐藏被静默跳过,直到墙上时间追平;
/// Instant 只随进程单调前进,不受改钟影响。锁只做瞬时存取,不跨调用持有。
static DRAG_SESSION_AT: Mutex<Option<Instant>> = Mutex::new(None);

/// 拖动会话空闲阈值:最后一次 Moved 之后超过它就视为已松手(松手后再无 Moved,
/// 「最后一次 Moved + 阈值」天然就是松手时刻)。取 300ms 而非更长,是为了让松手后
/// 紧接着点别的窗口所产生的 Focused(false) 仍算正常失焦、照常把窗口隐藏;阈值过大
/// (曾为 1200ms)会把它误判成拖动中的失焦而丢弃,「失焦自动隐藏」下
/// 「松手后点别处关闭」这个手势就丢了。300ms 远大于拖动中相邻 Moved 的间隔,
/// 拖到一半不会因暂停而误判超时。
const DRAG_SESSION_IDLE: Duration = Duration::from_millis(300);

/// 是否处于拖动会话中(events.rs 用它跳过失焦隐藏)
pub fn drag_session_active() -> bool {
    // Option<Instant> 是 Copy,拷出后立即释放锁;锁中毒(仅持锁 panic)时按无会话处理
    let at = match DRAG_SESSION_AT.lock() {
        Ok(g) => *g,
        Err(_) => None,
    };
    at.map(|t| t.elapsed() < DRAG_SESSION_IDLE).unwrap_or(false)
}

/// 进入拖动会话(页面在 startDragging 之前调用)
pub fn begin_drag_session() {
    touch_drag_session();
}

/// 续期拖动会话(拖动中的 Moved 调用)
pub fn touch_drag_session() {
    if let Ok(mut g) = DRAG_SESSION_AT.lock() {
        *g = Some(Instant::now());
    }
}

/// 退出拖动会话(页面 mouseup 调用;hide() 也会清)
pub fn end_drag_session() {
    if let Ok(mut g) = DRAG_SESSION_AT.lock() {
        *g = None;
    }
}

/// 窗口位置变化即落库(events.rs 在 Moved 上调):拖动由系统模态移动循环处理,
/// 松手事件到不了页面、焦点也不一定变化,位置只能在移动过程中写;最后一个 Moved 就是最终位置。
/// 只有窗口确实可见时才写,避免把创建期默认位置(96,96)覆盖成用户记忆。
pub fn commit_position(app: &AppHandle) {
    if let Some(w) = win(app) {
        if w.is_visible().unwrap_or(false) {
            remember_position(app, &w);
        }
    }
}

/// 把当前窗口位置写入设置(调用方先确认窗口可见)
fn remember_position(app: &AppHandle, w: &WebviewWindow) {
    if let Ok(p) = w.outer_position() {
        set_setting(app, "quick_x", &p.x.to_string());
        set_setting(app, "quick_y", &p.y.to_string());
    }
}

fn get_setting(app: &AppHandle, key: &str) -> Option<String> {
    let db: tauri::State<Db> = app.state();
    let conn = db.0.lock().ok()?;
    repos::settings::get(&conn, key).ok().flatten()
}

fn set_setting(app: &AppHandle, key: &str, value: &str) {
    if let Some(db) = app.try_state::<Db>() {
        if let Ok(conn) = db.0.lock() {
            let _ = repos::settings::set(&conn, key, value);
        }
    }
}

fn win(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("quick")
}

pub fn toggle(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = win(app) {
        if w.is_visible().unwrap_or(false) {
            hide(app)
        } else {
            show(app)
        }
    } else {
        Ok(())
    }
}

pub fn show(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = win(app) {
        // 恢复记忆的几何
        if let (Some(x), Some(y)) = (get_setting(app, "quick_x"), get_setting(app, "quick_y")) {
            if let (Ok(x), Ok(y)) = (x.parse::<i32>(), y.parse::<i32>()) {
                let _ = w.set_position(PhysicalPosition::new(x, y));
            }
        }
        // 尺寸 = 基础尺寸(quick_w/quick_h)x 缩放系数,再由工作区收口;缩放同时落到 webview zoom。
        // 读回值可能被手改成 NaN/越界,clamp_scale 收敛到 0.5-2.0(非有限值回退 1.0)。
        let zoom = get_setting(app, "quick_zoom")
            .and_then(|s| s.parse::<f64>().ok())
            .map(quick_scale::clamp_scale)
            .unwrap_or(1.0);
        let _ = quick_scale::apply_scale(app, zoom);
        // 恢复记忆的置顶状态(默认 true);隐藏窗口上设置亦安全,须在 show 前
        let pin = get_setting(app, "quick_always_on_top")
            .map(|v| v != "false")
            .unwrap_or(true);
        let _ = w.set_always_on_top(pin);
        // 窗口实际已隐藏而 tao 缓存认为仍可见时(例如被外部 ShowWindow(SW_HIDE) 隐藏过),
        // show() 的 flags diff 为空会静默早退、窗口唤不出来。系统未可见时先 hide() 对齐缓存,
        // 再 show();两边一致时这步是空操作。
        if !w.is_visible().unwrap_or(true) {
            let _ = w.hide(); // 尽力而为:对齐失败也要继续走主操作 show()
        }
        w.show()?;
        w.set_focus()?;
    }
    Ok(())
}

pub fn hide(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = win(app) {
        // 「隐藏前确实在屏幕上」是本函数一切副作用的开关:
        // 启动阶段 tao 对**尚未显示过**的隐藏窗口也会发一次 Focused(false),若此时开了
        // 「失焦自动隐藏」,windowing/events 会立刻调到这里;这时读到的 outer_position 只是
        // tauri.conf.json 的创建默认位置(实测 96,96),写回会把用户记忆的位置覆盖掉
        // (实测 724,428 -> 96,96,重启即丢)。同理,没显示过的窗口不需要 quick-hiding 兜底。
        let was_visible = w.is_visible().unwrap_or(false);
        if was_visible {
            remember_position(app, &w);
            // 隐藏前给页面最后一次 flush 机会:透明度的 200ms 节流 / 缩放 IPC 可能仍在途,
            // 而 hide() 不触发 onFocusChanged(实测),窗口隐藏后页面计时器还可能被冻结。
            // 页面监听 quick-hiding 并立即结算(见 QuickCapture)。发送失败只能吞掉:
            // 事件是尽力而为,绝不能因它阻断隐藏。
            let _ = w.emit("quick-hiding", ());
        }
        // 尺寸不回写:窗口不可手动 resize(resizable:false),所有尺寸变化都经
        // set_quick_size(apply_size,按意图写回)或 apply_scale;由 outer_size 反推基础尺寸
        // 会把钳制/工作区收口的结果固化成"用户的基础尺寸"(缩放系数越大越错),且无法还原。
        // 窗口实际可见而 tao 缓存认为已隐藏时(例如被外部 ShowWindow / SetWindowPos
        // (SWP_SHOWWINDOW) 显示过,或由系统恢复),hide() 的 flags diff 为空会静默早退
        // (返回 Ok 但窗口留在屏幕上)。先 show() 让缓存对齐,再 hide() 才真正执行 SW_HIDE;
        // 窗口本来就隐藏时跳过 show(),避免闪现。
        // 隐藏意味着会话已结束:清掉拖动标志,避免残留让后续失焦隐藏全部失效
        end_drag_session();
        if was_visible {
            let _ = w.show(); // 尽力而为:对齐失败也要继续走主操作 hide()
        }
        w.hide()?;
    }
    Ok(())
}

/// 失焦是否自动隐藏(贴纸模式:默认不隐藏,仅显式设 "true" 才隐藏)
pub fn blur_hide_enabled(app: &AppHandle) -> bool {
    get_setting(app, "quick_hide_on_blur").map(|v| v == "true").unwrap_or(false)
}
