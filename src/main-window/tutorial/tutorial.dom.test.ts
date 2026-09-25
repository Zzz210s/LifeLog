// @vitest-environment jsdom
/**
 * 引导层的容器证据之一:**渲染与回退链 + 两个出口的语义**(模态部分见 tutorial-modal.dom.test.ts)。
 * 几何(洞口外扩、气泡翻转/钳位)在 Task 1 的纯函数单测里钉死,这里只测渲染与交互。
 */
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TutorialLayer } from './TutorialLayer';
import { RECT, anchorOf, createHarness, destroyHarness, stubSyncFrames, type Harness } from './__fixtures__/tutorial-harness';

let h: Harness;

beforeEach(() => {
  stubSyncFrames();
  h = createHarness();
});

afterEach(() => destroyHarness(h));

describe('引导层:渲染与回退链', () => {
  it('按锚点渲染当前步:标题、步序、对话框语义(role/aria-modal/aria-labelledby)', async () => {
    anchorOf('input');
    h.mount();
    await h.settle();
    const bubble = h.$('tutorial-bubble') as HTMLElement;
    expect(bubble.getAttribute('role')).toBe('dialog');
    expect(bubble.getAttribute('aria-modal')).toBe('true');
    const labelled = bubble.getAttribute('aria-labelledby') as string;
    const h2 = bubble.querySelector('h2') as HTMLElement;
    expect(labelled).toBeTruthy();
    expect(h2.id).toBe(labelled);
    expect(h2.textContent).toBe('在这里记下一切');
    expect(h.stepText()).toContain('第 1 / 4 步');
  });

  it('推进时跳过锚点缺失的步骤(第 1 步 -> 直接到第 4 步)', async () => {
    anchorOf('input');
    anchorOf('topbar'); // 2/3 步的锚点都不在场
    h.mount();
    await h.settle();
    expect(h.stepText()).toContain('第 1 / 4 步');
    await h.click('tutorial-next');
    expect(h.stepText()).toContain('第 4 / 4 步');
    expect(h.host.textContent).toContain('还有这些');
  });

  it('节点在场但矩形为 0(display:none / 未渲染)不算命中:跳过该步', async () => {
    const ghost = document.createElement('div');
    ghost.setAttribute('data-testid', 'unified-input'); // 主窗停在设置页时 StreamView 只是 hidden
    ghost.getBoundingClientRect = () => ({ ...RECT, width: 0, height: 0 } as DOMRect);
    document.body.appendChild(ghost);
    anchorOf('topbar');
    h.mount();
    await h.settle();
    expect(h.stepText()).toContain('第 4 / 4 步');
  });
});

describe('引导层:前置动作(侧栏隐藏时的第 3 步)', () => {
  it('锚点因侧栏隐藏而缺失时,先执行 onShowSidebar 再解析 —— 不把该步跳过', async () => {
    const onShowSidebar = vi.fn(() => {
      // 前置动作真的把侧栏显示出来(真实实现里 sidebar.setVisible(true) 的效果)
      anchorOf('tags');
    });
    anchorOf('input'); // 第 2 步(prefix-hint)锚点缺失,靠回退跳过
    anchorOf('topbar');
    h.mount({ onShowSidebar });
    await h.settle();
    expect(h.stepText()).toContain('第 1 / 4 步');
    await h.click('tutorial-next'); // -> 第 3 步(第 2 步锚点缺失被跳过)
    await h.settle();
    expect(onShowSidebar).toHaveBeenCalled();
    expect(h.stepText()).toContain('第 3 / 4 步');
  });
});

describe('引导层:前置动作后要等锚点真的可测量', () => {
  it('侧栏要过几帧才渲染出来:该步不被误跳过(实测踩过的坑)', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const onShowSidebar = vi.fn(); // 只"开始显示侧栏",锚点要过几帧才出现
    anchorOf('input');
    anchorOf('topbar');
    h.mount({ onShowSidebar });
    await h.settle();
    await h.click('tutorial-next'); // -> 第 2 步锚点缺失 -> 解析到第 3 步:触发前置动作
    // 前置动作刚跑完的这几帧里侧栏还没提交:锚点仍缺,此刻**不能**把第 3 步判成跳过
    for (let i = 0; i < 3; i++) {
      act(() => {
        (frames.shift() as FrameRequestCallback | undefined)?.(0);
      });
      await h.settle();
    }
    expect(onShowSidebar).toHaveBeenCalledTimes(1);
    expect(h.stepText()).not.toContain('第 4 / 4 步'); // 跳到第 4 步 = 第 3 步被误跳过
    anchorOf('tags'); // 侧栏渲染出来了
    act(() => {
      while (frames.length > 0) (frames.shift() as FrameRequestCallback)(0);
    });
    await h.settle();
    expect(h.stepText()).toContain('第 3 / 4 步');
  });
});

describe('引导层:两个出口的语义', () => {
  it('Esc 退出并调 onExit 一次', async () => {
    anchorOf('input');
    h.mount();
    await h.settle();
    h.press('Escape');
    await h.settle();
    expect(h.onExit).toHaveBeenCalledTimes(1);
    expect(h.$('tutorial-bubble')).toBeNull();
  });

  it('点覆盖层不退出(防误触)', async () => {
    anchorOf('input');
    h.mount();
    await h.settle();
    await h.click('tutorial-root');
    expect(h.onExit).not.toHaveBeenCalled();
    expect(h.$('tutorial-root')).not.toBeNull();
  });

  it('透明底板盖住整屏(含洞口)且吃掉点击:模态不放行到下层', async () => {
    anchorOf('input');
    // 外层是"下层应用"的替身:它挂在引导层**外面**,若事件不被吞就会命中它的 onClick
    const outerClick = vi.fn();
    h.render(
      createElement(
        'div',
        { onClick: outerClick },
        createElement(TutorialLayer, { open: true, onExit: h.onExit, onUnavailable: () => {} })
      )
    );
    await h.settle();
    const scrim = h.$('tutorial-scrim') as HTMLElement;
    expect(scrim).not.toBeNull();
    // 底板是整屏的:洞口那块空白也在它覆盖范围内(所以洞口内点击不会落到下层输入框)
    expect(scrim.className).toContain('inset-0');
    await h.click('tutorial-scrim');
    expect(outerClick).not.toHaveBeenCalled(); // 被吞:到不了下层
    expect(h.onExit).not.toHaveBeenCalled();   // 也不退出
  });

  it('末步按钮文案是「完成」,点它调 onExit', async () => {
    anchorOf('topbar'); // 只放最后一个锚点:初始即落到末步
    h.mount();
    await h.settle();
    const next = h.$('tutorial-next') as HTMLElement;
    expect(next.textContent).toBe('完成');
    await h.click('tutorial-next');
    expect(h.onExit).toHaveBeenCalledTimes(1);
  });

  it('一步都显示不出来(重试两帧后):调 onUnavailable,不调 onExit', async () => {
    const onUnavailable = vi.fn();
    h.mount({ onUnavailable });
    await h.settle();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(h.onExit).not.toHaveBeenCalled();
  });
});
