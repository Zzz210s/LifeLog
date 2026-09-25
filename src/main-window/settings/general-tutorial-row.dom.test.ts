// @vitest-environment jsdom
/**
 * 设置页「通用」分区的新手引导行(计划 Task 3 / 设计 D6):一行「重新观看」,
 * 点了调回调(App 负责先回信息流视图再开引导层)。只读库信息与 opener 走 mock。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneralSection } from './GeneralSection';

const h = vi.hoisted(() => ({ getDbInfo: vi.fn() }));

vi.mock('../../shared/api', () => ({ api: { getDbInfo: h.getDbInfo } }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  h.getDbInfo.mockReset();
  h.getDbInfo.mockResolvedValue({ path: 'C:\\lifelog.db', notes: 3 });
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

/** 按可见文本找按钮(不注入假节点,直接查真实渲染结果) */
const buttonByText = (text: string): HTMLButtonElement | null =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text) ?? null;

describe('设置页「重新观看」', () => {
  it('通用分区有「新手引导」行,点「重新观看」调回调一次', async () => {
    const onReplayTutorial = vi.fn();
    act(() => root.render(createElement(GeneralSection, { onReplayTutorial })));
    await flush();
    expect(host.textContent).toContain('新手引导');
    const button = buttonByText('重新观看');
    expect(button).not.toBeNull();
    act(() => button?.click());
    expect(onReplayTutorial).toHaveBeenCalledTimes(1);
  });
});
