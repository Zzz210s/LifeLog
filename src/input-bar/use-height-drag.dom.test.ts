/**
 * 底边拖动改「最小高度」下限的数学:下限跟手、单位换算、上下限收口、误触不写库。
 *
 * 守的是 2026-10-16 的缺陷:高度原先只能由内容自动决定,用户拖上下带只会移动窗口 ——
 * 想固定一个更高的输入区做不到。把 use-height-drag 的 clampMinHeightFrom 换成硬区间、
 * 或去掉位移除以 ratio,下面几条立刻变红。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEIGHT_CSS,
  ONE_LINE,
  TWELVE_LINES,
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

describe('底边拖动 = 改最小高度(不移动窗口)', () => {
  it('底边带内的按下被接管:窗口跟手下移,松手写一次 input_min_h', async () => {
    await dom.dragBottom(60);
    expect(dom.min()).toBe(ONE_LINE + 60); // 基线 = 当前窗口高(1 行),位移 60 基础逻辑像素
    expect(dom.commits()).toEqual([ONE_LINE + 60]);
    expect(calls.startDragging).not.toHaveBeenCalled(); // 底边窄带不归「移动窗口」
    expect(calls.setPosition).not.toHaveBeenCalled();
    expect(calls.invoke).not.toHaveBeenCalledWith('begin_input_drag');
  });

  it('zoom 2.0(ratio 2)下位移按基础逻辑像素换算:屏幕位移要除以 ratio', async () => {
    state.ratio = 2;
    state.height = 2 * ONE_LINE; // 同一基础逻辑高,缩放 2 时窗口逻辑高翻倍
    await dom.dragBottom(40);
    expect(dom.min()).toBe(ONE_LINE + 20); // 40 逻辑像素 / 缩放 2 = 20 基础逻辑像素
    expect(dom.commits()).toEqual([ONE_LINE + 20]);
  });

  it('拖到底按 12 行上限收口', async () => {
    await dom.dragBottom(5000);
    expect(dom.min()).toBe(TWELVE_LINES);
  });

  it('工作区比 12 行更紧时按工作区收口(与宽度那条 80% 同源)', async () => {
    state.workAreaH = 200; // 工作区物理高 200 x 80% = 160 基础逻辑像素
    await dom.dragBottom(5000);
    expect(dom.min()).toBe(160);
  });

  it('向上拖到内容以下:下限变小,窗口由自动高度接管(不越下界)', async () => {
    state.height = 200; // 窗口当前比一行高(上一次下限留下的)
    await dom.dragBottom(-500);
    expect(dom.min()).toBe(ONE_LINE); // 下界 = 1 行,而不是 0:内容再短也留一行
    expect(dom.commits()).toEqual([ONE_LINE]);
  });

  it('基线在区间外(建议列表把窗口顶到 12 行以上)时拖动连续,不跳到 12 行上限', async () => {
    state.height = 360; // 列表展开时的窗口高(基础逻辑像素)
    await dom.dragBottom(-30);
    expect(dom.min()).toBe(330);
    expect(dom.commits()).toEqual([330]);
  });
});

describe('底边带的误触与双击', () => {
  it('底边带内只按一下(没有位移)不写库,也不改下限', async () => {
    state.height = 120; // 窗口比内容高:没有死区的话这一下会把 120 固化成下限
    dom.down(HEIGHT_CSS - 1);
    await dom.settle();
    await dom.mouseUp();
    expect(dom.commits()).toEqual([]);
    expect(dom.min()).toBe(0);
  });

  it('底边带双击 = 复位到纯自动(写 0),不进移动', () => {
    dom.down(HEIGHT_CSS - 1, 2);
    expect(dom.min()).toBe(0);
    expect(dom.commits()).toEqual([0]);
    expect(dom.doubleClicks()).toBe(0); // 双击动作归复位,不触发全局双击(隐藏)
    expect(calls.startDragging).not.toHaveBeenCalled();
  });
});
