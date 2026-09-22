/**
 * 标签新鲜度出口的单测(T6 修复轮 I2):订阅/退订、同一微任务内合并、
 * 合并窗口结束后再次通知照常触发(不能因为一次合并把后续通知吞掉)。
 */
import { describe, expect, it, vi } from 'vitest';
import { notifyTagsChanged, onTagsChanged } from './tags-changed';

/** 合并窗口是宏任务:等一个 setTimeout(0) 才能看到回调 */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('tags-changed:标签新鲜度唯一出口', () => {
  it('通知后 listener 收到一次(在合并窗口后落地)', async () => {
    const seen = vi.fn();
    const off = onTagsChanged(seen);
    notifyTagsChanged();
    expect(seen).not.toHaveBeenCalled(); // 同步不回调:合并窗口
    await tick();
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it('同一轮事件循环内多次通知合并为一次重载', async () => {
    const seen = vi.fn();
    const off = onTagsChanged(seen);
    notifyTagsChanged();
    notifyTagsChanged();
    notifyTagsChanged();
    await tick();
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it('跨微任务的连续通知也合并(写库出口 + 既有 reload 各通知一次 -> 只重载一次)', async () => {
    const seen = vi.fn();
    const off = onTagsChanged(seen);
    notifyTagsChanged();
    await Promise.resolve(); // 让"await 写库"的续体先跑:它会再通知一次
    notifyTagsChanged();
    await tick();
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it('退订后不再收到(主窗卸载不留订阅)', async () => {
    const seen = vi.fn();
    onTagsChanged(seen)();
    notifyTagsChanged();
    await tick();
    expect(seen).not.toHaveBeenCalled();
  });

  it('合并窗口结束后再次通知照常触发', async () => {
    const seen = vi.fn();
    const off = onTagsChanged(seen);
    notifyTagsChanged();
    await tick();
    notifyTagsChanged();
    await tick();
    expect(seen).toHaveBeenCalledTimes(2);
    off();
  });
});
