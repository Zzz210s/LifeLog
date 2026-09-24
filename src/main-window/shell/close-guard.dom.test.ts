// @vitest-environment jsdom
/**
 * 页面发起关闭的守卫测试(待办 #36):
 * `window.close()` 必须改走「隐藏到托盘」命令(销毁 webview 会让托盘再也唤不回窗口),
 * 同时保留原生入口到 `__rawClose` 供端到端用例验证 Rust 侧自愈。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const hideMainWindow = vi.fn(async () => {});
vi.mock('../../shared/api', () => ({ api: { hideMainWindow: () => hideMainWindow() } }));

const { installCloseGuard } = await import('./close-guard');

describe('主窗关闭守卫(#36)', () => {
  afterEach(() => {
    hideMainWindow.mockClear();
  });

  it('window.close() 改走隐藏命令,而不是销毁 webview', async () => {
    const raw = window.close;
    installCloseGuard();
    window.close();
    expect(hideMainWindow).toHaveBeenCalledTimes(1);
    window.close = raw; // 还原,避免污染同进程里的其它用例
  });

  it('原生关闭入口保留在 __rawClose(端到端自愈用例要用)', () => {
    const raw = window.close;
    installCloseGuard();
    expect(typeof window.__rawClose).toBe('function');
    expect(window.__rawClose).not.toBe(window.close); // 守卫已替换 window.close
    window.close = raw;
  });
});
