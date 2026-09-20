import { describe, expect, it } from 'vitest';
import { shouldOpenOnPending } from './use-open-settings';

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
