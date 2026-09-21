// @vitest-environment jsdom
/**
 * T1 边缘自动滚动的纯数学与帧循环证据:
 * 35px 触发带、0.3×越界量夹在 ±14px/帧、指针静止 1000ms 停止、stop() 立即停。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoscrollDelta, createDragAutoscroll } from './drag-autoscroll';

describe('autoscrollDelta(35px 触发带 / 0.3 系数 / ±14 夹取)', () => {
  it('带外(中间大片区域)不滚', () => {
    expect(autoscrollDelta(300, 0, 600)).toBe(0);
    expect(autoscrollDelta(35, 0, 600)).toBe(0);
    expect(autoscrollDelta(565, 0, 600)).toBe(0);
  });
  it('上缘带内向上滚,越界越多越快,夹在 -14', () => {
    expect(autoscrollDelta(30, 0, 600)).toBe(-2); // 0.3 * (30-35) = -1.5 -> floor -2
    expect(autoscrollDelta(0, 0, 600)).toBe(-11); // 0.3 * -35 = -10.5 -> floor -11
    expect(autoscrollDelta(-100, 0, 600)).toBe(-14); // 越界 135 -> -40.5 夹到 -14
  });
  it('下缘带内向下滚,夹在 +14', () => {
    expect(autoscrollDelta(570, 0, 600)).toBe(1); // 0.3 * 5 = 1.5 -> floor 1
    expect(autoscrollDelta(600, 0, 600)).toBe(10); // 0.3 * 35 = 10.5 -> floor 10
    expect(autoscrollDelta(900, 0, 600)).toBe(14); // 夹到 14
  });
});

describe('createDragAutoscroll 帧循环', () => {
  let frames: FrameRequestCallback[];
  let scrollTop: number;
  let rechecks: number;

  const scroller = (): HTMLElement =>
    ({
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(v: number) {
        scrollTop = v;
      },
      getBoundingClientRect: () => ({ top: 0, height: 600 }),
    }) as unknown as HTMLElement;

  const runFrame = (): void => {
    const pending = frames;
    frames = [];
    for (const cb of pending) cb(0);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    frames = [];
    scrollTop = 100;
    rechecks = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames = [];
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const make = () =>
    createDragAutoscroll({ scroller, active: () => true, recheck: () => void (rechecks += 1) });

  it('下缘悬停:每帧按位移滚动,并在滚动后重算落点', () => {
    const a = make();
    a.pointer(599, false);
    runFrame();
    expect(scrollTop).toBe(110); // 0.3 * (599-565) = 10.2 -> 10
    expect(rechecks).toBe(1);
    runFrame();
    expect(scrollTop).toBe(120);
    expect(rechecks).toBe(2);
    a.stop();
  });

  it('每帧位移不超过 ±14(封顶)', () => {
    const a = make();
    a.pointer(2000, false);
    runFrame();
    expect(scrollTop).toBe(114);
    a.stop();
  });

  it('指针静止 1000ms 后停:不再续帧也不再滚', () => {
    const a = make();
    a.pointer(599, false);
    runFrame();
    const after = scrollTop;
    vi.advanceTimersByTime(1001);
    runFrame();
    expect(scrollTop).toBe(after);
    expect(frames.length).toBe(0);
    a.stop();
  });

  it('合成回投事件不刷新"指针静止"计时(synthetic=true)', () => {
    const a = make();
    a.pointer(599, false);
    vi.advanceTimersByTime(900);
    a.pointer(599, true); // 回投:不刷新 movedAt
    vi.advanceTimersByTime(200);
    runFrame();
    expect(frames.length).toBe(0);
    a.stop();
  });

  it('stop() 立即停(拖拽结束不再滚)', () => {
    const a = make();
    a.pointer(599, false);
    a.stop();
    expect(frames.length).toBe(0);
  });
});
