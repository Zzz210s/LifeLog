// @vitest-environment jsdom
/**
 * 设置页 Esc 返回信息流(2026-10-07):与关系图同一手感 —— 顶栏导航组是鼠标入口,Esc 是键盘入口。
 * 输入/选择控件上的 Esc 不退出(原生 select 展开时 Esc 先关下拉,再冒泡不该顺带退视图)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from './SettingsView';

vi.mock('../../shared/api', () => ({
  api: {
    getSetting: () => Promise.resolve(null),
    setSetting: () => Promise.resolve(),
    getDbInfo: () => Promise.resolve({ path: 'C:/tmp/lifelog.db', notes: 3 }),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const esc = (target: EventTarget = window): void => {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
};

const render = async (onBack?: () => void): Promise<void> => {
  await act(async () => {
    root.render(createElement(SettingsView, { themeMode: 'system', onThemeChange: () => {}, onBack }));
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe('设置页 Esc 返回', () => {
  it('按 Esc 调 onBack 一次', async () => {
    const onBack = vi.fn();
    await render(onBack);
    esc();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('未传 onBack 时挂载不报错、Esc 无事发生', async () => {
    await expect(render()).resolves.toBeUndefined();
    esc();
  });

  it('输入控件上的 Esc 不退出(让原生 select 先关下拉)', async () => {
    const onBack = vi.fn();
    await render(onBack);
    const input = document.createElement('input');
    host.appendChild(input);
    esc(input);
    expect(onBack).not.toHaveBeenCalled();
  });
});
