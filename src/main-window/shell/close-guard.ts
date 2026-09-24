/**
 * 页面发起的「关闭页面」守卫(待办 #36)。
 *
 * 背景(2026-09-23 实测):主窗页面里执行 `window.close()` 会走 WebView2 自己的关闭流程,
 * **不经过 Tauri 的 `WindowEvent::CloseRequested`**,于是「关闭 = 退到托盘」那套(见
 * `src-tauri/src/windowing/main_window.rs` 的 attach_close_to_tray)完全被绕过:
 * webview 被销毁,而 Tao 窗口的 HWND 与 Tauri 的窗口句柄都还在 —— 托盘「打开主窗口」
 * 调 `show()` 时返回 Ok 却是空操作,窗口再也不会变成可用状态(用户看到的症状)。
 *
 * 守卫做法:覆盖 `window.close()`,改走既有的「隐藏到托盘」命令(与标题栏 X 同语义)。
 * 保留原生关闭入口到 `__rawClose` 仅作**测试缝**:端到端用例需要它能真的销毁 webview,
 * 以验证 Rust 侧的自愈重建路径(`open()` 里的活性探针)。
 */
import { api } from '../../shared/api';

declare global {
  interface Window {
    /** 原生 `window.close`(测试缝:仅验收脚本使用,业务代码不要调) */
    __rawClose?: () => void;
  }
}

export function installCloseGuard(): void {
  const raw = window.close.bind(window);
  window.__rawClose = raw;
  window.close = () => {
    // 与标题栏 X / 托盘「隐藏」同一语义:隐藏窗口,不销毁 webview,草稿与页面状态都留着
    void api.hideMainWindow();
  };
}
