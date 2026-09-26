// @vitest-environment jsdom
/**
 * 主窗侧的引导接线(计划 Task 3):自己读一次 `ui.tutorial_seen` 决定挂不挂层,
 * 并给出三条出口 —— 完成/跳过/Esc 写标记、`onUnavailable` **不写标记**、重看不受标记限制。
 *
 * 夹具是**真 hook**(App 挂载时原样调用它)+ 与 App 同样的条件渲染(`open && <层/>`),
 * 只有 IPC 走 mock。写标记的次数是这里最要盯的一条:一枚用户动作只能写一次。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTutorialEntry } from './use-tutorial-entry';
import type { TutorialEntry } from './use-tutorial-entry';

const h = vi.hoisted(() => ({
  seen: null as string | null,
  setSetting: vi.fn(),
}));

vi.mock('../../shared/api', () => ({
  api: {
    getSetting: (key: string) => Promise.resolve(key === 'ui.tutorial_seen' ? h.seen : null),
    setSetting: h.setSetting,
    // 引导会临时收起输入栏(见 use-tutorial-input-bar):这里给最小桩,单独的行为由它自己的测试覆盖
    inputBarVisible: async () => false,
    hideInputBar: async () => undefined,
    showInputWindow: async () => undefined,
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest: TutorialEntry;
let order: string[];
let root: Root;
let host: HTMLDivElement;

function Harness({ beforeReplay }: { beforeReplay: () => void }): ReactNode {
  latest = useTutorialEntry(beforeReplay);
  order.push(`render:${String(latest.open)}`);
  // 与 App 的渲染行同一形态:条件挂载(重看时重新挂载,层内状态自然复位)
  return latest.open ? createElement('div', { 'data-testid': 'tutorial-layer' }) : null;
}

const rendered = (): boolean => host.querySelector('[data-testid="tutorial-layer"]') !== null;

beforeEach(() => {
  h.seen = null;
  h.setSetting.mockReset();
  h.setSetting.mockResolvedValue(undefined);
  order = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

const mount = async (beforeReplay: () => void = () => {}): Promise<void> => {
  act(() => root.render(createElement(Harness, { beforeReplay })));
  await flush();
};

describe('主窗的引导入口', () => {
  it('未看过(无标记):挂上层', async () => {
    await mount();
    expect(latest.open).toBe(true);
    expect(rendered()).toBe(true);
  });

  it('已看过("1"):不挂层,也不碰标记', async () => {
    h.seen = '1';
    await mount();
    expect(latest.open).toBe(false);
    expect(rendered()).toBe(false);
    expect(h.setSetting).not.toHaveBeenCalled();
  });

  it('用户动作结束:关层并写一次标记', async () => {
    await mount();
    act(() => latest.onExit());
    expect(rendered()).toBe(false);
    expect(h.setSetting.mock.calls).toEqual([['ui.tutorial_seen', '1']]);
  });

  it('一步都显示不出来(onUnavailable):只关层,**不写标记**(下次启动再试)', async () => {
    await mount();
    act(() => latest.onUnavailable());
    expect(rendered()).toBe(false);
    expect(h.setSetting).not.toHaveBeenCalled();
  });

  it('设置页「重新观看」:回信息流视图 + 挂上层,且不受标记限制', async () => {
    h.seen = '1'; // 已看过(正常情况):重看仍然要开
    let view = 'settings';
    await mount(() => { view = 'stream'; }); // 替身:App 的 setView('stream')
    expect(rendered()).toBe(false);
    act(() => latest.onReplay());
    // 断言"真的回到信息流":回看回调执行后视图必须已归位(锚点都在信息流视图上,
    // 停在设置页会让锚点全是零矩形 -> 引导落到第 3 步甚至不可用)
    expect(view).toBe('stream');
    expect(rendered()).toBe(true);
    expect(h.setSetting).not.toHaveBeenCalled();
  });
});
