// @vitest-environment jsdom
/**
 * 引导层的容器证据之二:**模态**(键盘闸门 + 焦点锁在气泡内)。
 * 自 tutorial.dom.test.ts 拆出(两个文件加起来会破 200 行红线)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchorOf, createHarness, destroyHarness, stubSyncFrames, type Harness } from './__fixtures__/tutorial-harness';

let h: Harness;

beforeEach(() => {
  stubSyncFrames();
  h = createHarness();
});

afterEach(() => destroyHarness(h));

describe('引导层:模态键盘闸门', () => {
  it('引导开着时,落在引导之外的按键不放行给应用(窗口级快捷键被拦)', async () => {
    anchorOf('input');
    const appHotkey = vi.fn(); // 替身:应用挂在 window 上的快捷键监听(bubble 阶段)
    window.addEventListener('keydown', appHotkey);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
    expect(appHotkey).toHaveBeenCalledTimes(1); // 自检:监听器本身工作
    appHotkey.mockClear();
    h.mount();
    await h.settle();
    // 焦点在气泡内(挂载即聚焦),此时按键不该被拦
    expect(document.activeElement?.getAttribute('data-testid')).toBe('tutorial-bubble');
    h.press('p', false, { ctrlKey: true });
    expect(appHotkey).toHaveBeenCalledTimes(1);
    appHotkey.mockClear();
    // 焦点被挪到引导之外(body)-> 按键被闸门吞掉,应用收不到
    (document.activeElement as HTMLElement | null)?.blur();
    h.press('p', false, { ctrlKey: true });
    expect(appHotkey).not.toHaveBeenCalled();
    // Esc 仍能退出(闸门给它放行)
    h.press('Escape');
    await h.settle();
    expect(h.onExit).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', appHotkey);
  });
});

describe('引导层:模态(焦点锁在气泡内)', () => {
  it('进门聚焦气泡;输入框抢到焦点会被拉回(打字进不去)', async () => {
    const input = anchorOf('input', 'textarea') as HTMLTextAreaElement;
    h.mount();
    await h.settle();
    const bubble = h.$('tutorial-bubble') as HTMLElement;
    expect(document.activeElement).toBe(bubble);
    input.focus();
    expect(document.activeElement).toBe(bubble);
  });

  it('Tab 在气泡内循环(跳过 <-> 下一步)', async () => {
    anchorOf('input');
    h.mount();
    await h.settle();
    h.press('Tab');
    expect(document.activeElement).toBe(h.$('tutorial-skip'));
    h.press('Tab');
    expect(document.activeElement).toBe(h.$('tutorial-next'));
    h.press('Tab');
    expect(document.activeElement).toBe(h.$('tutorial-skip'));
    h.press('Tab', true);
    expect(document.activeElement).toBe(h.$('tutorial-next'));
  });
});
