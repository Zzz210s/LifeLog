import { describe, expect, it } from 'vitest';
import { quickResetKeys, quickRows } from './settings-model';

describe('quickRows', () => {
  it('恰好 9 项且顺序与设计一致', () => {
    expect(quickRows().map((r) => r.key)).toEqual([
      'alwaysOnTop', 'hideOnBlur', 'zoomStep', 'defaultOpacity', 'opacityStep',
      'lockMove', 'lockClose', 'lockContent', 'doubleClickAction',
    ]);
  });
  it('每项都有中文标签与说明', () => {
    for (const r of quickRows()) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.hint.length).toBeGreaterThan(0);
    }
  });
  it('双击动作为下拉且有两项', () => {
    const row = quickRows().find((r) => r.key === 'doubleClickAction')!;
    expect(row.kind).toBe('select');
    expect(row.options?.map((o) => o.value)).toEqual(['hide', 'none']);
  });
});

describe('quickResetKeys', () => {
  it('返回全部 9 个键', () => {
    expect(quickResetKeys()).toHaveLength(9);
  });
});
