// @vitest-environment jsdom
/**
 * 数据版本 -> 重取(G3 Task 5):版本变了才叫 `reload()`。
 *
 * 四条口径:挂载不重取(第一次拉取归 `useGraphData`)、同版本重渲染不动、每跳一次重取一次、
 * 卸载后不再响应。后两条专门盯「自造机制」:本 hook 只认版本号,不直接订阅标签变更通道
 * —— 通道自己响(版本没变)不能绕过版本、卸载后也不能留下会响的订阅。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyTagsChanged } from '../data/tags-changed';
import { useGraphVersion } from './use-graph-version';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let reload: ReturnType<typeof vi.fn>;
let root: Root;
let host: HTMLDivElement;

function Harness(p: { version: number }): null {
  useGraphVersion(p.version, reload);
  return null;
}

const render = async (version: number): Promise<void> => {
  await act(async () => {
    root.render(createElement(Harness, { version }));
  });
};

/** 把通道的合并窗口(一整轮宏任务)跑完 */
const laterRound = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
};

beforeEach(() => {
  reload = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('useGraphVersion:版本变化才重取', () => {
  it('挂载不重取;版本 1 -> 2 只重取一次', async () => {
    await render(1);
    expect(reload).not.toHaveBeenCalled(); // 第一次拉取归 useGraphData,不在这里重复
    await render(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('版本不变时重渲染不重取', async () => {
    await render(5);
    await render(5);
    await render(5);
    expect(reload).not.toHaveBeenCalled();
  });

  it('每跳一次都重取(1 -> 2 -> 3 是两次)', async () => {
    await render(1);
    await render(2);
    await render(3);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('通道自己响不算数:版本没变,标签变更通知也不重取', async () => {
    await render(7);
    notifyTagsChanged();
    await laterRound();
    expect(reload).not.toHaveBeenCalled();
  });

  it('卸载后不响应:退订干净,通道再响计数也不动', async () => {
    await render(1);
    await render(2);
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    notifyTagsChanged();
    await laterRound();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
