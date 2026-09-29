// @vitest-environment jsdom
/**
 * DPR 标识 hook:jsdom 没有 matchMedia,这里装一个假的媒体查询注册表,盯住三件事 ——
 * 首次按当前 dpr 盯查询、dpr 变化时更新取值并改盯新查询、卸载时摘监听。
 * 这条媒体查询是"纯 DPR 变化"(CSS 尺寸不变、resize 不响)时唯一的重绘触发源。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useDprKey } from './use-dpr-key';

let value = 0;
let dpr = 1.25;
let root: Root;
let host: HTMLDivElement;
/** 查询 -> 监听器集合(移除监听能观测到) */
let installed: Map<string, Set<() => void>>;

function Harness(): null {
  value = useDprKey();
  return null;
}

const fire = async (query: string): Promise<void> => {
  await act(async () => {
    for (const l of [...(installed.get(query) ?? [])]) l();
  });
};

beforeEach(() => {
  dpr = 1.25;
  installed = new Map();
  vi.stubGlobal('matchMedia', (query: string) => {
    const set = installed.get(query) ?? new Set<() => void>();
    installed.set(query, set);
    return {
      matches: true,
      media: query,
      addEventListener: (_type: string, l: () => void) => set.add(l),
      removeEventListener: (_type: string, l: () => void) => set.delete(l),
    } as unknown as MediaQueryList;
  });
  Object.defineProperty(window, 'devicePixelRatio', { get: () => dpr, configurable: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(Harness));
  });
};

describe('useDprKey', () => {
  it('按当前 dpr 盯一条 resolution 查询:dpr 一变就更新取值并改盯新查询,卸载摘干净', async () => {
    await mount();
    expect(value).toBe(1.25);
    expect([...installed.keys()]).toEqual(['(resolution: 1.25dppx)']);
    expect(installed.get('(resolution: 1.25dppx)')?.size).toBe(1);

    dpr = 1.5;
    await fire('(resolution: 1.25dppx)');
    expect(value).toBe(1.5);
    expect(installed.get('(resolution: 1.5dppx)')?.size).toBe(1); // 已改盯新查询
    expect(installed.get('(resolution: 1.25dppx)')?.size).toBe(0); // 旧查询的监听已摘

    act(() => root.unmount());
    expect(installed.get('(resolution: 1.5dppx)')?.size).toBe(0);
  });
});
