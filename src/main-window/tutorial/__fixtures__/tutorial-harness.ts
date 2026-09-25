// @vitest-environment jsdom
/**
 * 引导层测试的共用夹具(自 tutorial.dom.test.ts 拆出:那两个文件加起来会破 200 行红线)。
 *
 * jsdom 的 getBoundingClientRect 恒为 0,而 `findAnchor` 要求**非零矩形** —— 锚点桩自带矩形。
 * 锚点一律按 `steps.ts` 的**真实选择器**造,选择器改了这里当场红。
 */
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import { TUTORIAL_STEPS } from '../steps';
import { TutorialLayer } from '../TutorialLayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const RECT = {
  x: 200, y: 100, top: 100, left: 200, width: 300, height: 40, right: 500, bottom: 140,
  toJSON: () => ({}),
} as DOMRect;

/** 按某一步的首选选择器造一个"真的能显示"的锚点(非零矩形) */
export function anchorOf(id: string, tag = 'div'): HTMLElement {
  const step = TUTORIAL_STEPS.find((s) => s.id === id);
  const m = step === undefined ? null : /\[([\w-]+)="([^"]+)"\]/.exec(step.selectors[0]);
  if (step === undefined || m === null) throw new Error(`锚点取不到: ${id}`);
  const el = document.createElement(tag);
  el.setAttribute(m[1], m[2]);
  el.getBoundingClientRect = () => RECT;
  document.body.appendChild(el);
  return el;
}

/** 每帧同步跑掉的 rAF 桩:重试与测量都在 act 里一次跑完,断言不必等真实帧 */
export function stubSyncFrames(): void {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', () => {});
}

export interface Harness {
  root: Root;
  host: HTMLDivElement;
  onExit: ReturnType<typeof vi.fn>;
  $: (testid: string) => HTMLElement | null;
  stepText: () => string;
  mount: (props?: Record<string, unknown>) => void;
  /** 自定义渲染(已包 act):给需要在外层套"下层应用替身"的用例用 */
  render: (node: ReactElement) => void;
  settle: () => Promise<void>;
  click: (testid: string) => Promise<void>;
  press: (key: string, shift?: boolean, mod?: KeyboardEventInit) => void;
}

export function createHarness(): Harness {
  const onExit = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  const $ = (testid: string): HTMLElement | null => host.querySelector(`[data-testid="${testid}"]`);
  const settle = async (): Promise<void> => {
    await act(async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
  };
  // onUnavailable 必填(类型强制):默认给空实现,要断言它的用例自己传
  const mount = (props: Record<string, unknown> = {}): void => {
    act(() => root.render(createElement(TutorialLayer, { open: true, onExit, onUnavailable: () => {}, ...props })));
  };
  return {
    root,
    host,
    onExit,
    $,
    stepText: () => $('tutorial-step')?.textContent ?? '',
    mount,
    render: (node: ReactElement) => {
      act(() => root.render(node));
    },
    settle,
    click: async (testid: string) => {
      act(() => ($(testid) as HTMLElement).click());
      await settle();
    },
    /** 真实按键的 target 是**当前聚焦元素**(不是 window);派发到 window 会让"同节点同相位"绕过闸门 */
    press: (key: string, shift = false, mod: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true, ...mod });
      const target = (document.activeElement as HTMLElement | null) ?? document.body;
      act(() => target.dispatchEvent(e));
    },
  };
}

export function destroyHarness(h: Harness): void {
  act(() => h.root.unmount());
  h.host.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
}
