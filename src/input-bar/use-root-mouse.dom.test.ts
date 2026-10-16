/**
 * 根鼠标路由的优先级契约:底边带归「改最小高度」,**优先于**上下带的「移动窗口」,
 * 而移动仍由顶边带与「可见卡片内侧那条带」两条路保证。
 *
 * 守的是 2026-10-16 的缺陷:底边带原先判进「移动窗口」,高度只能靠内容自动定。
 * 把 useRootMouse 里的 height 分支删掉、或排到 band 之后,前两条立刻变红。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ONE_LINE,
  mountRootMouse,
  type RootMouseDom,
} from './root-mouse-test-kit';

const state = vi.hoisted(() => ({ ratio: 1, scale: 1, height: 69, workAreaH: 2000 }));
const calls = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  startDragging: vi.fn(async () => undefined),
  setPosition: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: calls.invoke }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging: calls.startDragging, setPosition: calls.setPosition }),
  PhysicalPosition: class {
    constructor(public x: number, public y: number) {}
  },
  currentMonitor: async () => ({ workArea: { size: { width: 1920, height: state.workAreaH } } }),
}));
vi.mock('../shared/api', () => ({ api: { focusInputBar: async () => undefined, setSetting: async () => undefined } }));
vi.mock('./logical-size', () => ({
  currentRatio: () => state.ratio,
  readGeometry: async () => ({
    width: 480,
    height: state.height,
    scale: state.scale,
    x: 0,
    y: 0,
    ratio: state.ratio,
  }),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let dom: RootMouseDom;

beforeEach(() => {
  state.ratio = 1;
  state.scale = 1;
  state.height = ONE_LINE;
  state.workAreaH = 2000;
  for (const fn of [calls.invoke, calls.startDragging, calls.setPosition]) fn.mockClear();
  dom = mountRootMouse({ state, calls });
});

afterEach(() => {
  dom.unmount();
});

describe('底边带优先于「移动窗口」', () => {
  it('底边带内的按下走高度拖动:不启动系统移动、不置位拖动会话', () => {
    dom.down(71); // 72 - 1:最后 20 CSS px 的底边带内
    expect(calls.startDragging).not.toHaveBeenCalled();
    expect(calls.invoke).not.toHaveBeenCalledWith('begin_input_drag');
  });

  it('底边带内双击走复位,不触发全局双击动作(全局双击 = 隐藏)', () => {
    dom.down(71, 2);
    expect(dom.commits()).toEqual([0]);
    expect(dom.doubleClicks()).toBe(0);
    expect(calls.startDragging).not.toHaveBeenCalled();
  });

  it('底边带之外的下半区(文字区)既不改高度也不移动,留给文本选择', () => {
    dom.down(36);
    expect(dom.commits()).toEqual([]);
    expect(calls.startDragging).not.toHaveBeenCalled();
  });
});

describe('移动窗口没被弄没', () => {
  it('顶边带仍启动系统移动(光晕环,5 CSS px 处)', async () => {
    dom.down(5);
    await dom.settle(); // 置位 begin_input_drag 之后才进系统移动循环
    expect(calls.startDragging).toHaveBeenCalledTimes(1);
    expect(dom.commits()).toEqual([]); // 不误改下限
  });

  it('可见卡片内侧那条带仍启动系统移动(GLOW_PAD 14 + 内侧 3 px)', async () => {
    dom.down(17);
    await dom.settle();
    expect(calls.startDragging).toHaveBeenCalledTimes(1);
    expect(dom.min()).toBe(0);
    expect(dom.commits()).toEqual([]);
  });
});
