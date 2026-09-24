/**
 * 11 条命令的副作用逐条落地(T6 brief 要求「11 条命令逐一接线证据」)。
 * 覆盖:新建笔记聚焦统一输入框、标签页切换、设置页、主题循环、侧栏、专注模式、
 * 导出/重建索引的进行中状态、改全局热键跳设置并聚焦录制器、退出带确认。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { callRun, mountAppCommands } from './app-commands-harness';
import type { AppCommandsHarness } from './app-commands-harness';
import { HOTKEY_RECORDER_SELECTOR, UNIFIED_INPUT_SELECTOR, nextThemeMode } from './use-app-commands';

const { rebuildSearchIndex, quitApp } = vi.hoisted(() => ({
  rebuildSearchIndex: vi.fn(async () => 2),
  quitApp: vi.fn(async () => {}),
}));
const { confirm } = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }));
vi.mock('../../shared/api', () => ({ api: { rebuildSearchIndex, quitApp } }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm }));

/** 让 focusWhenPresent 的重试在同一 tick 内跑完 */
const flushFrames = (): void => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
};

let h: AppCommandsHarness;
beforeEach(() => {
  flushFrames();
  confirm.mockResolvedValue(true);
  rebuildSearchIndex.mockResolvedValue(2);
  h = mountAppCommands();
});
afterEach(() => {
  h.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

const add = (tag: string, attrs: Record<string, string>): HTMLElement => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
};

describe('命令副作用:注册表门禁与 11 条', () => {
  it('registry 由 withRuns 构造,11 条全在且 run 都不是占位', async () => {
    expect(h.commands().registry.all).toHaveLength(11);
    for (const cmd of h.commands().registry.all) await expect(callRun(h, cmd.id)).resolves.toBeUndefined();
  });
});

describe('命令副作用:视图与焦点', () => {
  it('note.new 聚焦统一输入框', async () => {
    const box = add('textarea', { 'data-testid': 'unified-input' });
    await callRun(h, 'note.new');
    expect(document.activeElement).toBe(box);
  });

  it('note.new 不再认旧 Composer 的 aria-label(选择器回归防护)', async () => {
    const legacy = add('textarea', { 'aria-label': '记点什么' });
    const box = add('textarea', { 'data-testid': 'unified-input' });
    await callRun(h, 'note.new');
    expect(document.activeElement).toBe(box);
    expect(document.activeElement).not.toBe(legacy);
  });

  it('settings.open 切设置页;hotkey.edit 切设置页并聚焦录制器', async () => {
    await callRun(h, 'settings.open');
    expect(h.setView).toHaveBeenCalledWith('settings');

    const rec = add('button', { 'aria-label': '录制快捷键' });
    await callRun(h, 'hotkey.edit');
    expect(h.setView).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(rec);
    expect(HOTKEY_RECORDER_SELECTOR).toBe('button[aria-label="录制快捷键"]');
    expect(UNIFIED_INPUT_SELECTOR).toBe('[data-testid="unified-input"]');
  });

  it('tab.next / tab.prev 按当前活动页循环(读最新状态,不是闭包旧值)', async () => {
    await callRun(h, 'tab.next');
    expect(h.tabs.activate).toHaveBeenLastCalledWith(2);
    h.tabs.activeIndex = 0;
    await callRun(h, 'tab.prev');
    expect(h.tabs.activate).toHaveBeenLastCalledWith(2); // (0-1+3)%3
    h.tabs.count = 0;
    await callRun(h, 'tab.next');
    expect(h.tabs.activate).toHaveBeenCalledTimes(2); // 无标签页时不动作
  });

  it('theme.cycle 走亮 -> 暗 -> 跟随系统;sidebar.toggle 取反', async () => {
    expect([nextThemeMode('light'), nextThemeMode('dark'), nextThemeMode('system')]).toEqual([
      'dark',
      'system',
      'light',
    ]);
    h.theme.mode = 'light';
    await callRun(h, 'theme.cycle');
    expect(h.theme.setMode).toHaveBeenLastCalledWith('dark');
    h.theme.mode = 'dark';
    await callRun(h, 'theme.cycle');
    expect(h.theme.setMode).toHaveBeenLastCalledWith('system');

    h.sidebar.visible = true;
    await callRun(h, 'sidebar.toggle');
    expect(h.sidebar.setVisible).toHaveBeenLastCalledWith(false);
  });

  it('focus.mode 快照侧栏后隐藏,再次执行还原', async () => {
    h.sidebar.visible = true;
    await callRun(h, 'focus.mode');
    expect(h.sidebar.setVisible).toHaveBeenLastCalledWith(false);

    h.sidebar.visible = false; // 专注模式期间用户没动侧栏
    await callRun(h, 'focus.mode');
    expect(h.sidebar.setVisible).toHaveBeenLastCalledWith(true); // 还原到快照
  });
});

describe('命令副作用:导出 / 重建索引 / 退出', () => {
  it('export.all 调既有导出并显示进行中状态,结束清掉', async () => {
    let release!: () => void;
    h.exportAll.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    const done = h.commands().execute('export.all'); // 不 await:先看"进行中"
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.status()).toEqual({ kind: 'running', text: '正在导出整库…' });
    await act(async () => {
      release();
      await done;
    });
    expect(h.exportAll).toHaveBeenCalledTimes(1);
    expect(h.status()).toBeNull();
  });

  it('search.reindex 调 Rust 重建并显示「已重建 N 条」', async () => {
    await callRun(h, 'search.reindex');
    expect(rebuildSearchIndex).toHaveBeenCalledTimes(1);
    expect(h.status()).toEqual({ kind: 'done', text: '搜索索引已重建(2 条)' });
  });

  it('search.reindex 失败不静默:错误条 + 清掉进行中状态', async () => {
    rebuildSearchIndex.mockRejectedValueOnce(new Error('库锁住了'));
    await callRun(h, 'search.reindex');
    expect(h.setError).toHaveBeenCalledWith('action', expect.stringContaining('库锁住了'));
    expect(h.status()).toBeNull();
  });

  it('app.quit 带确认:确认才退;取消则不退', async () => {
    await callRun(h, 'app.quit');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(quitApp).toHaveBeenCalledTimes(1);

    confirm.mockResolvedValueOnce(false);
    await callRun(h, 'app.quit');
    expect(quitApp).toHaveBeenCalledTimes(1); // 没增加
  });
});
