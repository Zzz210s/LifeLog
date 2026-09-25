// @vitest-environment jsdom
/**
 * 引导层的容器证据之三:**锚点重试预算与「不可用」判据**。
 * 自 tutorial.dom.test.ts 拆出(三个文件合起来会破 200 行红线)。
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchorOf, createHarness, destroyHarness, stubSyncFrames, type Harness } from './__fixtures__/tutorial-harness';

let h: Harness;

beforeEach(() => {
  stubSyncFrames();
  h = createHarness();
});

afterEach(() => destroyHarness(h));

describe('引导层:锚点重试与「不可用」', () => {
  it('重试预算用完才报不可用(ANCHOR_RETRIES 帧,不是第一帧就报)', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const onUnavailable = vi.fn();
    // 不传 onShowSidebar:没有前置动作可做,直接走重试预算这条路径
    h.mount({ onUnavailable });
    await h.settle();
    expect(onUnavailable).not.toHaveBeenCalled(); // 首次解析失败不算"一步都显示不出来"
    act(() => {
      (frames.shift() as FrameRequestCallback | undefined)?.(0);
    });
    await h.settle();
    expect(onUnavailable).not.toHaveBeenCalled(); // 预算还没用完
    act(() => {
      while (frames.length > 0) (frames.shift() as FrameRequestCallback)(0);
    });
    await h.settle();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it('重试窗口内锚点就位:不当成「不可用」,更不写标记', async () => {
    const frames: FrameRequestCallback[] = [];
    // 这个用例要的是**真实时序**:帧回调排队,由我们在锚点就位后手动推进
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const onUnavailable = vi.fn();
    h.mount({ onUnavailable });
    await h.settle();
    expect(onUnavailable).not.toHaveBeenCalled(); // 重试还没走完:别急着判「一步都显示不出来」
    expect(h.onExit).not.toHaveBeenCalled();
    anchorOf('input'); // 布局稳定期结束,锚点渲染出来
    act(() => {
      while (frames.length > 0) (frames.shift() as FrameRequestCallback)(0);
    });
    await h.settle();
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(h.onExit).not.toHaveBeenCalled(); // 只有用户动作才写标记
    expect(h.stepText()).toContain('第 1 / 5 步');
  });
});
