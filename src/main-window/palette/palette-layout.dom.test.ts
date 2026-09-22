// 浮层不改布局:主内容区 getBoundingClientRect() 在开/关前后零位移。
// jsdom 没有排版引擎,所以给「流内区域」装一个**可证伪**的测量桩(高度 = 流内块之和),
// 并用一条灵敏度对照证明读数会随流内块变化 —— 否则断言恒等于 0 没有任何意义。
// @vitest-environment jsdom
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ITEMS, mountHost } from './palette-harness';
import type { Mounted } from './palette-harness';
import { Palette } from './Palette';
import { usePalette } from './use-palette';
import type { PaletteController } from './use-palette';

const box: { c: PaletteController | null } = { c: null };

function LayoutHost(p: { extra: boolean }): ReactNode {
  const controller = usePalette({ items: ITEMS });
  box.c = controller;
  return createElement(
    'div',
    null,
    createElement(
      'main',
      { className: 'flow-area' },
      createElement('div', { className: 'block-300' }),
      p.extra ? createElement('div', { className: 'block-40' }) : null,
    ),
    createElement(Palette, { controller }),
  );
}

/** 测量桩:只有 .flow-area 是流内区域,高度等于其子块高度之和 */
function installFlowRects(): () => void {
  const proto = HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    let height = 0;
    if (this.classList.contains('flow-area')) {
      for (const child of Array.from(this.children)) {
        if (child.classList.contains('block-300')) height += 300;
        if (child.classList.contains('block-40')) height += 40;
      }
    }
    return {
      x: 0, y: 0, width: 800, height, top: 0, left: 0, right: 800, bottom: height,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return () => {
    proto.getBoundingClientRect = original;
  };
}

let mounted: Mounted | null = null;

beforeEach(() => {
  box.c = null;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function mainHeight(): number {
  const main = document.querySelector('main');
  if (main === null) throw new Error('主内容区未渲染');
  return main.getBoundingClientRect().height;
}

function controller(): PaletteController {
  if (box.c === null) throw new Error('controller 未就绪');
  return box.c;
}

describe('浮层不改布局', () => {
  it('开/关前后主区读数零位移,且在关闭后仍回到原值', () => {
    const restore = installFlowRects();
    try {
      mounted = mountHost(() => createElement(LayoutHost, { extra: false }));
      const before = mainHeight();
      expect(before).toBe(300);

      act(() => controller().open('>'));
      expect(mainHeight()).toBe(before); // 打开:零位移
      const palette = document.querySelector('[data-floating="palette"]');
      expect(palette).not.toBeNull();
      expect((palette as HTMLElement).className).toMatch(/\bfixed\b/); // 覆盖式定位,不参与流
      expect(document.querySelector('main')?.contains(palette)).toBe(false); // 不在主区流内

      act(() => controller().close());
      expect(mainHeight()).toBe(before); // 关闭:零位移
    } finally {
      restore();
    }
  });

  it('灵敏度对照:主区真的多/少一个流内块时读数必须变', () => {
    const restore = installFlowRects();
    try {
      mounted = mountHost(() => createElement(LayoutHost, { extra: false }));
      expect(mainHeight()).toBe(300);
      mounted.rerender(() => createElement(LayoutHost, { extra: true }));
      expect(mainHeight()).toBe(340);
      mounted.rerender(() => createElement(LayoutHost, { extra: false }));
      expect(mainHeight()).toBe(300);
    } finally {
      restore();
    }
  });

  it('60vh 上限落在面板根节点,列表只在剩余高度里滚动(M2)', () => {
    const restore = installFlowRects();
    try {
      mounted = mountHost(() => createElement(LayoutHost, { extra: false }));
      act(() => controller().open('>'));
      const panel = document.querySelector('[data-floating="palette"]');
      expect(panel?.className).toMatch(/max-h-\[60vh\]/);
      expect(panel?.className).toMatch(/\bflex-col\b/);
      const list = document.querySelector('[role="listbox"]');
      expect(list?.className).not.toMatch(/max-h/);
      expect(list?.className).toMatch(/\bflex-1\b/);
    } finally {
      restore();
    }
  });
});
