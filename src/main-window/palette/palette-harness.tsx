/**
 * 浮层组件测试的共用挂载层(仅测试引用;文件名不含 .test,不被 vitest 收集,也不进构建;
 * 照 `sidebar/drag-harness.tsx` 的既有做法)。
 * 只负责挂载 / 派遣真实事件 / 读取 controller,不做断言 —— 断言留在各自的 *.dom.test.ts。
 */
import { act, createElement, useRef } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ListRow, QuickPickItem } from '../../shared/quickpick/model';
import { Palette } from './Palette';
import type { RowDecoration } from './PaletteRow';
import { usePalette } from './use-palette';
import { usePaletteHotkeys } from './use-palette-hotkeys';
import type { AppHotkeyReading } from './use-palette-hotkeys';
import type { PaletteController } from './use-palette';

// jsdom 里 act() 需要显式开启,否则每次状态更新都刷一条 stderr 警告
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const ITEMS: readonly QuickPickItem[] = [
  { id: 'note.new', label: '新建笔记' },
  { id: 'settings.open', label: '打开设置' },
  { id: 'theme.cycle', label: '切换主题' },
];

export interface Mounted {
  host: HTMLDivElement;
  rerender(build: () => ReactNode): void;
  unmount(): void;
}

/** 最小挂载层:调用方给一个组件工厂(需要重渲染时用 rerender 传新的工厂) */
export function mountHost(build: () => ReactNode): Mounted {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act(() => root.render(createElement(build)));
  return {
    host,
    rerender: (next) => act(() => root.render(createElement(next))),
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

export interface PaletteHarness extends Mounted {
  /** onAccept 的调用记录(id + keepOpen) */
  accepted: Array<{ id: string; keepOpen: boolean }>;
  controller(): PaletteController;
  input(): HTMLInputElement;
  /** 在输入框上派发真实 keydown(浮层的 window 监听靠冒泡收到) */
  press(key: string, init?: KeyboardEventInit): void;
  /** 在「当前焦点元素」(如焦点被挪到 body 后)派发真实 keydown,复现键盘监听不能只挂在输入框 */
  pressOnFocus(key: string, init?: KeyboardEventInit): void;
  /** 在浮层之外的指定元素(如 Composer 文本域)派发真实 keydown,复现 window 监听收到外部按键 */
  pressFrom(el: Element, key: string, init?: KeyboardEventInit): void;
  /** 在任意目标上派发真实 mousedown(冒泡到 window,用于浮层外关闭) */
  mouseDown(target: EventTarget): void;
  open(prefix?: string): void;
  /** 真实 input 事件(受控输入:必须用原生 setter 才触发 React onChange) */
  type(value: string): void;
}

export interface PaletteHarnessOptions {
  items?: readonly QuickPickItem[];
  decorations?: Readonly<Record<string, RowDecoration>>;
  onAccept?: (row: ListRow, keepOpen: boolean) => void;
  /** 归位锚点(N2/N3):真挂载时由 T6 传主区容器,这里用测试自带容器 */
  anchor?: HTMLElement | null;
}

/** 标准夹具:触发按钮 + 浮层(不接真 provider,T6 才接) */
export function paletteHarness(options: PaletteHarnessOptions = {}): PaletteHarness {
  const accepted: Array<{ id: string; keepOpen: boolean }> = [];
  const box: { c: PaletteController | null } = { c: null };
  const items = options.items ?? ITEMS;

  const mounted = mountHost(() => {
    function Host(): ReactNode {
      const anchorRef = useRef<HTMLElement | null>(null);
      anchorRef.current = options.anchor ?? null;
      const controller = usePalette({
        items,
        anchorRef,
        onAccept: (row, keepOpen) => {
          accepted.push({ id: row.item.id, keepOpen });
          options.onAccept?.(row, keepOpen);
        },
      });
      box.c = controller;
      return createElement(
        'div',
        null,
        createElement('button', { id: 'palette-trigger', type: 'button' }, '打开'),
        createElement(Palette, { controller, decorations: options.decorations }),
      );
    }
    return createElement(Host);
  });

  const controller = (): PaletteController => {
    if (box.c === null) throw new Error('controller 未就绪');
    return box.c;
  };
  const input = (): HTMLInputElement => {
    const el = document.querySelector<HTMLInputElement>('[role="combobox"]');
    if (el === null) throw new Error('输入框未渲染');
    return el;
  };

  return {
    ...mounted,
    accepted,
    controller,
    input,
    press: (key, init = {}) => {
      const el = input();
      act(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
      });
    },
    pressOnFocus: (key, init = {}) => {
      const el = document.activeElement ?? document.body;
      act(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
      });
    },
    pressFrom: (el, key, init = {}) => {
      act(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
      });
    },
    mouseDown: (target) => {
      act(() => {
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      });
    },
    open: (prefix = '') => act(() => controller().open(prefix)),
    type: (value) => {
      const el = input();
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      act(() => {
        setValue?.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
  };
}

export interface HotkeyHarness {
  /** onTrigger 收到的前缀序列('>' 命令面板 / '' 笔记) */
  triggered: string[];
  /** 写入当前存储值(每次按键现读) */
  setReading(next: AppHotkeyReading): void;
  pressWindow(init: KeyboardEventInit): KeyboardEvent;
  unmount(): void;
}

/** 应用内快捷键夹具:只挂监听,不渲染浮层 */
export function hotkeyHarness(): HotkeyHarness {
  const triggered: string[] = [];
  let reading: AppHotkeyReading = {};
  const mounted = mountHost(() => {
    function Host(): ReactNode {
      usePaletteHotkeys({ onTrigger: (prefix) => triggered.push(prefix), read: () => reading });
      return null;
    }
    return createElement(Host);
  });
  return {
    triggered,
    setReading: (next) => {
      reading = next;
    },
    pressWindow: (init) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      act(() => window.dispatchEvent(event));
      return event;
    },
    unmount: mounted.unmount,
  };
}
