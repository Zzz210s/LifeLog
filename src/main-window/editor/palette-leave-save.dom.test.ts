/**
 * 浮层与「点区块外即保存」的交互(T5 复审 §2.2 的校正后顺序,必须由 T6 钉住):
 *
 * - 浮层**内**的 pointerdown 不算「区块外」-> 不触发保存(设计 §8 风险一)。
 * - 浮层**外**的一次按下:先 `document pointerdown` 触发保存(**此时浮层仍开着**),
 *   随后 `window mousedown` 才关浮层。禁止用 controller.isOpen 当保存前置条件。
 * - 指针关闭路径不测焦点归位(mousedown 默认动作在派发后执行,会覆盖归位;复审 §2.2)。
 */
// @vitest-environment jsdom
import { act, createElement, useRef } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLeaveSave } from './use-leave-save';
import { EditPanel } from './EditPanel';
import { hasEditingPanel } from './edit-flush';
import { Palette } from '../palette/Palette';
import { usePalette } from '../palette/use-palette';
import type { PaletteController } from '../palette/use-palette';
import type { Note } from '../../shared/types';

const { updateNote, parseNoteSource } = vi.hoisted(() => ({
  updateNote: vi.fn(async () => null),
  parseNoteSource: vi.fn(async () => ({ content: '', tags: [] })),
}));
vi.mock('../../shared/api', () => ({ api: { updateNote, parseNoteSource } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  controller(): PaletteController;
  /** 事件序列:flush(保存触发)/ closed(浮层关闭) */
  order: string[];
  /** 每次 pointerdown 触发保存时浮层是否仍开着 */
  openAtFlush: boolean[];
  unmount(): void;
}

function mount(): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  const order: string[] = [];
  const openAtFlush: boolean[] = [];
  const box: { c: PaletteController | null } = { c: null };

  act(() =>
    root.render(
      createElement(function Host(): ReactNode {
        const panelRef = useRef<HTMLLIElement>(null);
        const controller = usePalette({ items: [{ id: 'x', label: '甲' }] });
        box.c = controller;
        useLeaveSave({
          panelRef,
          flush: async () => {
            order.push('flush');
            openAtFlush.push(controller.isOpen);
            return { ok: true, changed: true };
          },
          onCancel: () => {},
          shouldEnterEdit: () => false,
        });
        return createElement(
          'div',
          null,
          createElement('li', { ref: panelRef, id: 'panel' }, createElement('textarea', { id: 'box' })),
          createElement('div', { id: 'outside' }, '别处'),
          createElement(Palette, { controller }),
        );
      }),
    ),
  );

  return {
    controller: () => box.c as PaletteController,
    order,
    openAtFlush,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const down = (el: Element, type: string): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  });
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('浮层 x 离开保存:一次外部按下的事件序列', () => {
  it('浮层内按下不触发保存(也不算区块外)', () => {
    const h = mount();
    act(() => h.controller().open(''));
    const row = document.querySelector('[data-row-id="x"]') as Element;
    down(row, 'pointerdown');
    down(row, 'mousedown');
    expect(h.order).toEqual([]);
    expect(h.controller().isOpen).toBe(true);
    h.unmount();
  });

  it('浮层外按下:先保存(浮层仍开),随后 window mousedown 关浮层', () => {
    const h = mount();
    act(() => h.controller().open(''));
    const outside = document.getElementById('outside')!;

    down(outside, 'pointerdown'); // 真实顺序:doc pointerdown -> win pointerdown -> doc mousedown -> win mousedown
    expect(h.order).toEqual(['flush']);
    expect(h.openAtFlush).toEqual([true]); // 保存触发时浮层**仍然开着**
    expect(h.controller().isOpen).toBe(true);

    down(outside, 'mousedown');
    expect(h.controller().isOpen).toBe(false);
    expect(h.order).toEqual(['flush']); // 关浮层不再触发第二次保存
    h.unmount();
  });

  it('编辑面板内的按下既不保存也不关浮层(区块内继续编辑)', () => {
    const h = mount();
    act(() => h.controller().open(''));
    const box = document.getElementById('box')!;
    down(box, 'pointerdown');
    expect(h.order).toEqual([]);
    h.unmount();
  });
});

describe('EditPanel 把 flush 登记进命令通道', () => {
  it('编辑面板在场 -> 已登记;卸载 -> 注销(命令执行前的 flush 只对活着的面板生效)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const note: Note = { id: 7, content: '买牛奶', created_at: '2026-09-22 10:00:00', tags: [] };
    expect(hasEditingPanel()).toBe(false);
    await act(async () => {
      root.render(createElement(EditPanel, { note, onSaved: () => {}, onCancel: () => {} }));
    });
    expect(hasEditingPanel()).toBe(true);
    act(() => root.unmount());
    expect(hasEditingPanel()).toBe(false);
    host.remove();
  });
});
