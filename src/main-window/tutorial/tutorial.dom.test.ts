// @vitest-environment jsdom
/**
 * Task 2 的容器证据:覆盖层 / 气泡 / 引导层(渲染、回退跳步、模态焦点锁、两个出口)。
 * jsdom 的 getBoundingClientRect 恒为 0,而 `findAnchor` 要求**非零矩形** —— 锚点桩自带矩形;
 * 几何(洞口外扩、气泡翻转/钳位)已在 Task 1 的纯函数单测里钉死,这里只测渲染与交互。
 * 锚点一律按 `steps.ts` 的**真实选择器**造,选择器改了这里当场红。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TUTORIAL_STEPS } from './steps';
import { TutorialLayer } from './TutorialLayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECT = {
  x: 200, y: 100, top: 100, left: 200, width: 300, height: 40, right: 500, bottom: 140,
  toJSON: () => ({}),
} as DOMRect;

/** 按某一步的首选选择器造一个"真的能显示"的锚点(非零矩形 + 可聚焦的节点类型) */
function anchorOf(id: string, tag = 'div'): HTMLElement {
  const step = TUTORIAL_STEPS.find((s) => s.id === id);
  const m = step === undefined ? null : /\[([\w-]+)="([^"]+)"\]/.exec(step.selectors[0]);
  if (step === undefined || m === null) throw new Error(`锚点取不到: ${id}`);
  const el = document.createElement(tag);
  el.setAttribute(m[1], m[2]);
  el.getBoundingClientRect = () => RECT;
  document.body.appendChild(el);
  return el;
}

let root: Root;
let host: HTMLDivElement;
let onExit: ReturnType<typeof vi.fn>;

const $ = (testid: string): HTMLElement | null => host.querySelector(`[data-testid="${testid}"]`);
const stepText = (): string => $('tutorial-step')?.textContent ?? '';
const mount = (props: Record<string, unknown> = {}): void => {
  act(() => root.render(createElement(TutorialLayer, { open: true, onExit, ...props })));
};
/** 等 effect/渲染链跑完(act 内的微任务排空) */
const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
};
const click = async (testid: string): Promise<void> => {
  act(() => ($(testid) as HTMLElement).click());
  await settle();
};
const press = (key: string, shift = false): void => {
  const e = new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true });
  act(() => window.dispatchEvent(e));
};

beforeEach(() => {
  // 两帧 rAF 用同步桩:重试与测量都在 act 里一次跑完,断言不必等真实帧
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  onExit = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('引导层:渲染与回退链', () => {
  it('按锚点渲染当前步:标题、步序、对话框语义(role/aria-modal/aria-labelledby)', async () => {
    anchorOf('input');
    mount();
    await settle();
    const bubble = $('tutorial-bubble') as HTMLElement;
    expect(bubble.getAttribute('role')).toBe('dialog');
    expect(bubble.getAttribute('aria-modal')).toBe('true');
    const labelled = bubble.getAttribute('aria-labelledby') as string;
    const h2 = bubble.querySelector('h2') as HTMLElement;
    expect(labelled).toBeTruthy();
    expect(h2.id).toBe(labelled);
    expect(h2.textContent).toBe('在这里记下一切');
    expect(stepText()).toContain('第 1 / 5 步');
  });

  it('推进时跳过锚点缺失的步骤(第 1 步 -> 直接到第 5 步)', async () => {
    anchorOf('input');
    anchorOf('topbar'); // 2/3/4 步的锚点都不在场
    mount();
    await settle();
    expect(stepText()).toContain('第 1 / 5 步');
    await click('tutorial-next');
    expect(stepText()).toContain('第 5 / 5 步');
    expect(host.textContent).toContain('还有这些');
  });

  it('节点在场但矩形为 0(display:none / 未渲染)不算命中:跳过该步', async () => {
    const ghost = document.createElement('div');
    ghost.setAttribute('data-testid', 'unified-input'); // 主窗停在设置页时 StreamView 只是 hidden
    ghost.getBoundingClientRect = () => ({ ...RECT, width: 0, height: 0 } as DOMRect);
    document.body.appendChild(ghost);
    anchorOf('topbar');
    mount();
    await settle();
    expect(stepText()).toContain('第 5 / 5 步');
  });
});

describe('引导层:两个出口的语义', () => {
  it('Esc 退出并调 onExit 一次', async () => {
    anchorOf('input');
    mount();
    await settle();
    press('Escape');
    await settle();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect($('tutorial-bubble')).toBeNull();
  });

  it('点覆盖层不退出(防误触)', async () => {
    anchorOf('input');
    mount();
    await settle();
    await click('tutorial-root');
    expect(onExit).not.toHaveBeenCalled();
    expect($('tutorial-root')).not.toBeNull();
  });

  it('末步按钮文案是「完成」,点它调 onExit', async () => {
    anchorOf('topbar'); // 只放最后一个锚点:初始即落到末步
    mount();
    await settle();
    const next = $('tutorial-next') as HTMLElement;
    expect(next.textContent).toBe('完成');
    await click('tutorial-next');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('一步都显示不出来(重试两帧后):调 onUnavailable,不调 onExit', async () => {
    const onUnavailable = vi.fn();
    mount({ onUnavailable });
    await settle();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('重试窗口内锚点就位:不当成「不可用」,更不写标记', async () => {
    const frames: FrameRequestCallback[] = [];
    // 这个用例要的是**真实时序**:帧回调排队,由我们在锚点就位后手动推进
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const onUnavailable = vi.fn();
    mount({ onUnavailable });
    await settle();
    expect(onUnavailable).not.toHaveBeenCalled(); // 重试还没走完:别急着判「一步都显示不出来」
    expect(onExit).not.toHaveBeenCalled();
    anchorOf('input'); // 布局稳定期结束,锚点渲染出来
    act(() => {
      while (frames.length > 0) (frames.shift() as FrameRequestCallback)(0);
    });
    await settle();
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled(); // 只有用户动作才写标记
    expect(stepText()).toContain('第 1 / 5 步');
  });
});

describe('引导层:模态(焦点锁在气泡内)', () => {
  it('进门聚焦气泡;输入框抢到焦点会被拉回(打字进不去)', async () => {
    const input = anchorOf('input', 'textarea') as HTMLTextAreaElement;
    mount();
    await settle();
    const bubble = $('tutorial-bubble') as HTMLElement;
    expect(document.activeElement).toBe(bubble);
    act(() => input.focus());
    expect(document.activeElement).toBe(bubble);
  });

  it('Tab 在气泡内循环(跳过 <-> 下一步)', async () => {
    anchorOf('input');
    mount();
    await settle();
    press('Tab');
    expect(document.activeElement).toBe($('tutorial-skip'));
    press('Tab');
    expect(document.activeElement).toBe($('tutorial-next'));
    press('Tab');
    expect(document.activeElement).toBe($('tutorial-skip'));
    press('Tab', true);
    expect(document.activeElement).toBe($('tutorial-next'));
  });
});
