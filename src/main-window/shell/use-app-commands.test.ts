/**
 * `execute` 的执行纪律:先 flush 编辑态再 run(单测断言调用顺序)、flush 失败不执行且不静默、
 * 未知 id 报中文错误。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerEditFlush } from '../editor/edit-flush';
import { mountAppCommands, runCommand } from './__fixtures__/app-commands-harness';
import type { AppCommandsHarness } from './__fixtures__/app-commands-harness';

vi.mock('../../shared/api', () => ({ api: { rebuildSearchIndex: vi.fn(), quitApp: vi.fn() } }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn(async () => true) }));

let h: AppCommandsHarness;
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (cb(0), 0));
  document.body.innerHTML = '';
  const box = document.createElement('textarea');
  box.setAttribute('data-testid', 'unified-input');
  document.body.appendChild(box);
  h = mountAppCommands();
});
afterEach(() => {
  h.unmount();
  registerEditFlush(null);
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('execute:先 flush 再 run', () => {
  it('顺序 = flush -> run(命令切视图前必须先把编辑内容落库)', async () => {
    const order: string[] = [];
    registerEditFlush(async () => {
      order.push('flush');
      return { ok: true };
    });
    h.sidebar.setVisible.mockImplementation(() => order.push('run'));
    await runCommand(h, 'sidebar.toggle');
    expect(order).toEqual(['flush', 'run']);
    expect(h.sidebar.setVisible).toHaveBeenCalledWith(false);
  });

  it('flush 失败:不执行命令,并把中文原因落到错误条', async () => {
    const order: string[] = [];
    registerEditFlush(async () => {
      order.push('flush');
      return { ok: false, message: '内容不能为空' };
    });
    // 用真实 registry:note.new 会聚焦统一输入框,若被执行则 activeElement 会变
    const before = document.activeElement;
    await runCommand(h, 'note.new');
    expect(order).toEqual(['flush']);
    expect(document.activeElement).toBe(before);
    expect(h.setError).toHaveBeenCalledWith('action', '命令未执行:内容不能为空');
  });

  it('没有编辑面板时 flush 放行(命令照常执行)', async () => {
    registerEditFlush(null);
    await runCommand(h, 'settings.open');
    expect(h.setView).toHaveBeenCalledWith('settings');
    expect(h.setError).not.toHaveBeenCalled();
  });

  it('未知命令 id:中文错误条,不抛', async () => {
    await runCommand(h, 'nope.nope');
    expect(h.setError).toHaveBeenCalledWith('action', '未知命令:nope.nope');
  });
});
