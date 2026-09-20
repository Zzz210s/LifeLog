import { describe, expect, it } from 'vitest';
import { consumePendingAfterEvent, shouldOpenOnPending } from './use-open-settings';

describe('shouldOpenOnPending', () => {
  it('pending 为 true 才切设置页', () => {
    expect(shouldOpenOnPending(true)).toBe(true);
  });

  it('取走为空 / 假值 / 异常载荷都不动视图', () => {
    expect(shouldOpenOnPending(false)).toBe(false);
    expect(shouldOpenOnPending(null)).toBe(false);
    expect(shouldOpenOnPending(undefined)).toBe(false);
    expect(shouldOpenOnPending('true')).toBe(false);
    expect(shouldOpenOnPending(0)).toBe(false);
  });
});

describe('consumePendingAfterEvent(事件通道的 pending 兜底)', () => {
  it('事件到达时确实取用一次(清掉双通道留下的残留)', () => {
    let calls = 0;
    consumePendingAfterEvent(() => {
      calls++;
      return Promise.resolve(true);
    });
    expect(calls).toBe(1);
  });

  it('取用失败不抛出、不影响切页', async () => {
    let calls = 0;
    consumePendingAfterEvent(() => {
      calls++;
      return Promise.reject(new Error('IPC 失败'));
    });
    await Promise.resolve();
    expect(calls).toBe(1);
  });
});
