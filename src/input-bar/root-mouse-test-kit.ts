/**
 * 输入栏根鼠标路由用例的共享夹具(仅测试引用):vi.mock 的工厂会被提升到导入之前,只能留在
 * 用例文件里手写;状态与 spy 对象由调用方构造后传进来 —— 本 kit 只负责挂载、派发事件与读数。
 * 抽出来的理由与 completions-test-kit 同:路由优先级与底边拖动数学两份用例都要这套
 * 「真输入框 + 真 useRootMouse + 合成按下/拖动」,复制一份既容易漂移又会顶破 200 行红线。
 */
import { act, createElement, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Mock } from 'vitest';
import { useRootMouse } from './use-root-mouse';

export interface RootMouseState {
  /** 逻辑像素 / CSS 像素 = webview 缩放 */
  ratio: number;
  /** 系统缩放 */
  scale: number;
  /** 当前窗口逻辑高(基础逻辑 x ratio) */
  height: number;
  /** 显示器工作区物理高 */
  workAreaH: number;
}

export interface RootMouseCalls {
  invoke: Mock;
  startDragging: Mock;
  setPosition: Mock;
}

export const WIDTH_CSS = 480;
export const HEIGHT_CSS = 72;
/** 与真机同源的行高/内边距:text-sm + leading-relaxed 22.75,py-2 上下各 9 → 固定附加 46;
 *  border 显式归零:jsdom 默认样式表给 textarea 挂了 16px 边框(真机由 Tailwind preflight 归零) */
export const TEXT_STYLE = {
  lineHeight: '22.75px',
  paddingTop: '9px',
  paddingBottom: '9px',
  border: '0px solid transparent',
};
/** 1 行 / 12 行对应的基础逻辑高(见 input-geometry 的 minHeightLo/Hi 算式) */
export const ONE_LINE = 69;
export const TWELVE_LINES = 319;

export interface RootMouseDom {
  shell: HTMLDivElement;
  /** 当前下限(基础逻辑像素) */
  min(): number;
  /** 每次写库的值(commitMin 调用序) */
  commits(): number[];
  doubleClicks(): number;
  /** 让 startHeightDrag 里的 await(几何读数 / 显示器工作区)走完 */
  settle(): Promise<void>;
  down(clientY: number, detail?: number): void;
  mouseUp(): Promise<void>;
  /** 从底边按下并拖 delta 屏幕像素后松手 */
  dragBottom(delta: number): Promise<void>;
  unmount(): void;
}

export function mountRootMouse(_args: { state: RootMouseState; calls: RootMouseCalls }): RootMouseDom {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let min = 0;
  const commits: number[] = [];
  let doubleClicks = 0;

  function Harness(): ReactNode {
    const ta = useRef<HTMLTextAreaElement | null>(null);
    const [value, setValue] = useState(0);
    min = value;
    const onMouseDown = useRootMouse({
      lock: { move: false, close: false, content: false },
      textareaRef: ta,
      onDoubleClick: () => {
        doubleClicks++;
      },
      onMiddleDown: () => false,
      applyMin: setValue,
      commitMin: (h) => {
        commits.push(h);
      },
    });
    return createElement(
      'div',
      { onMouseDown },
      createElement('textarea', { ref: ta, style: TEXT_STYLE, readOnly: true }),
    );
  }

  act(() => {
    root.render(createElement(Harness));
  });
  const shell = host.firstElementChild as HTMLDivElement;
  // jsdom 布局全为 0:按窗口根节点的真实几何(480 x 72 CSS px)打桩
  shell.getBoundingClientRect = () => new DOMRect(0, 0, WIDTH_CSS, HEIGHT_CSS);

  const settle = async (): Promise<void> => {
    await act(async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
  };
  const down = (clientY: number, detail = 1): void => {
    act(() => {
      shell.dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: WIDTH_CSS / 2,
          clientY,
          screenY: clientY,
          button: 0,
          detail,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  };
  const mouseUp = async (): Promise<void> => {
    await act(async () => {
      window.dispatchEvent(new MouseEvent('mouseup', {}));
    });
  };
  const dragBottom = async (delta: number): Promise<void> => {
    down(HEIGHT_CSS - 1);
    await settle();
    await act(async () => {
      window.dispatchEvent(new MouseEvent('mousemove', { screenY: HEIGHT_CSS - 1 + delta, buttons: 1 }));
    });
    await mouseUp();
  };

  return {
    shell,
    min: () => min,
    commits: () => commits,
    doubleClicks: () => doubleClicks,
    settle,
    down,
    mouseUp,
    dragBottom,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
      document.body.innerHTML = '';
    },
  };
}
