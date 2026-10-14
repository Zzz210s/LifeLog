/**
 * 宽度拖动热区的接线测试:抓「看得见的卡片边缘」必须被宽度拖动接管,而不是落到「移动窗口」。
 *
 * 守的是 2026-10-14 装机版实测的坑:左右带原先只认 8 **逻辑像素**的屏幕空间热区
 * (物理宽度恒为 8 x 系统缩放),而可见卡片边缘在页面空间里恒在 GLOW_PAD(14 CSS px)处,
 * 两者只在缩放 ~0.57 时重合 —— zoom 1.0 下抓可见左边缘按下并拖 100 物理像素,
 * 窗口被移动、宽度一点没变(zoom 2.0 同样)。本文件把「按下点落在可见边缘 → 被接管」
 * 钉成契约:把 use-width-drag 的 cardEdgeBandCss 换回 edgeBandCss,zoom 1.0/2.0 两条用例立刻变红。
 */
// @vitest-environment jsdom
import { act, createElement, useRef } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GLOW_PAD } from '../shared/input-geometry';
import { useWidthDrag } from './use-width-drag';

/** 测试里可控的 ratio(逻辑像素 / CSS 像素 = webview 缩放);ratio 1 与 2 分别代表 zoom 1.0 / 2.0 */
const state = vi.hoisted(() => ({ ratio: 1 }));
const setInputSize = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setPosition: async () => undefined }),
  PhysicalPosition: class {
    constructor(public x: number, public y: number) {}
  },
}));
vi.mock('../shared/api', () => ({ api: { setInputSize } }));
vi.mock('./logical-size', () => ({
  currentRatio: () => state.ratio,
  readGeometry: async () => null, // 桩:本用例只判定「按下是否被接管」,不落窗口
}));

// React 19 要求显式声明「这是 act 环境」,否则 act() 会打印告警
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** 抓card边缘必须落进带内的长度上限(输入框左内边距 12 CSS px,再往里就是文字区) */
const TEXT_LEFT_EDGE_CSS = GLOW_PAD + 12;
const WIDTH_CSS = 480;
const HEIGHT_CSS = 72;

let host: HTMLDivElement;
let root: Root;
let events: HTMLDivElement;
let taken: boolean[];
let doubleClicks: number;
let handle: (e: React.MouseEvent) => boolean;

beforeEach(() => {
  setInputSize.mockClear();
  state.ratio = 1;
  taken = [];
  doubleClicks = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  function Harness(): ReactNode {
    const ta = useRef<HTMLTextAreaElement | null>(null);
    handle = useWidthDrag({ textareaRef: ta, onDoubleClick: () => doubleClicks++ });
    return createElement(
      'div',
      { onMouseDown: (e: React.MouseEvent) => taken.push(handle(e)) },
      createElement('textarea', { ref: ta }),
    );
  }
  act(() => root.render(createElement(Harness)));
  events = host.firstElementChild as HTMLDivElement;
  // jsdom 的布局全为 0:按「窗口根节点」的真实几何打桩(480 x 72 CSS px)
  const rect = new DOMRect(0, 0, WIDTH_CSS, HEIGHT_CSS);
  events.getBoundingClientRect = () => rect;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

function press(clientX: number, init: MouseEventInit = {}): void {
  act(() => {
    events.dispatchEvent(
      new MouseEvent('mousedown', { clientX, clientY: HEIGHT_CSS / 2, button: 0, detail: 1, bubbles: true, cancelable: true, ...init }),
    );
  });
}

describe('useWidthDrag 按下接管', () => {
  it('zoom 1.0:抓可见卡片边缘(GLOW_PAD 处)被宽度拖动接管', () => {
    state.ratio = 1;
    press(GLOW_PAD);
    expect(taken).toEqual([true]);
  });

  it('zoom 2.0:同样的按下点仍被接管(屏幕空间热区在此时只有 4 CSS px,够不着可见边缘)', () => {
    state.ratio = 2;
    press(GLOW_PAD);
    expect(taken).toEqual([true]);
  });

  it('可见边缘到文字之间也接管(用户不会每次都精确压线)', () => {
    state.ratio = 1;
    press(GLOW_PAD + 4);
    expect(taken).toEqual([true]);
    expect(GLOW_PAD + 4).toBeLessThan(TEXT_LEFT_EDGE_CSS);
  });

  it('右边缘对称接管', () => {
    state.ratio = 1;
    press(WIDTH_CSS - GLOW_PAD);
    expect(taken).toEqual([true]);
  });

  it('文字区里的按下不接管(留给「移动窗口」与文本选择)', () => {
    state.ratio = 1;
    press(TEXT_LEFT_EDGE_CSS + 20);
    press(WIDTH_CSS / 2);
    press(WIDTH_CSS - TEXT_LEFT_EDGE_CSS - 20);
    expect(taken).toEqual([false, false, false]);
  });

  it('非主键不接管(中键走恢复视图)', () => {
    state.ratio = 1;
    press(GLOW_PAD, { button: 1 });
    expect(taken).toEqual([false]);
  });

  it('带内双击走双击动作,不进宽度拖动', () => {
    state.ratio = 1;
    press(GLOW_PAD, { detail: 2 });
    expect(taken).toEqual([true]);
    expect(doubleClicks).toBe(1);
  });
});
