// @vitest-environment jsdom
/**
 * 画布容器上的两件接线(自 GraphView 抽出):首次适配**只做一次**(之后 `ready` 与 `fit` 引用
 * 怎么变都不再动相机,相机此后归用户),wheel 必须显式 `{ passive: false }`。
 * jsdom 不执行 passive(去掉选项也照样 `preventDefault` 成功),所以这里直接盯 `addEventListener`
 * 收到的选项 —— 只有这一条能咬住"有人把监听改成被动"。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoFit, usePassiveWheel } from './use-graph-surface';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 容器的 ref:每次挂载复用同一个对象(与 GraphView 的 useRef 同口径) */
const boxRef: { current: HTMLElement | null } = { current: null };
let fits = 0;
let ready = false;
let fit: () => void = () => undefined;
let wheel: (e: WheelEvent) => void = () => undefined;

function Harness(): null {
  useAutoFit(ready, fit);
  usePassiveWheel(boxRef, wheel);
  return null;
}

let root: Root;
let box: HTMLDivElement;

const render = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(Harness));
  });
};

beforeEach(() => {
  fits = 0;
  ready = false;
  fit = () => {
    fits += 1;
  };
  wheel = () => undefined;
  box = document.createElement('div');
  document.body.appendChild(box);
  boxRef.current = box;
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
  box.remove();
  boxRef.current = null;
  vi.restoreAllMocks();
});

describe('useAutoFit:首次适配只做一次', () => {
  it('没就绪不调用;就绪后调用一次,之后 ready / fit 引用再变也不动相机', async () => {
    await render();
    expect(fits).toBe(0);
    ready = true;
    await render();
    expect(fits).toBe(1);
    fit = () => {
      fits += 10;
    };
    await render(); // 换了 fit 引用(尺寸变化会让 cam.reset 换引用)
    expect(fits).toBe(1);
    ready = false;
    await render();
    ready = true;
    await render();
    expect(fits).toBe(1); // 回来也不再适配:此后只由 `0` 复位
  });
});

describe('usePassiveWheel:wheel 必须显式非被动', () => {
  it('挂载时以 { passive: false } 挂上,卸载时摘掉', async () => {
    const add = vi.spyOn(box, 'addEventListener');
    const remove = vi.spyOn(box, 'removeEventListener');
    await render();
    expect(add).toHaveBeenCalledWith('wheel', wheel, { passive: false });
    act(() => root.unmount());
    expect(remove).toHaveBeenCalledWith('wheel', wheel);
  });

  it('handler 换引用时重挂(旧监听摘掉,新的挂上)', async () => {
    const add = vi.spyOn(box, 'addEventListener');
    const remove = vi.spyOn(box, 'removeEventListener');
    await render();
    const old = wheel;
    wheel = () => undefined;
    await render();
    expect(remove).toHaveBeenCalledWith('wheel', old);
    expect(add).toHaveBeenLastCalledWith('wheel', wheel, { passive: false });
  });
});
