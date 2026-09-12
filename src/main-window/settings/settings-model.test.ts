import { describe, expect, it } from 'vitest';
import { QUICK_DEFAULTS } from '../../shared/quick-settings';
import { OPACITY_MAX, OPACITY_MIN, STEP_MAX, STEP_MIN } from '../../shared/quick-scale';
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
  // kind 是控件分派的唯一依据:错标会把布尔项渲染成百分比输入(或反之),
  // 且不会报错、只会静默改错值。故用 QUICK_DEFAULTS 的运行时类型逐行交叉校验。
  it('每行 kind 与字段默认值的类型一致', () => {
    for (const row of quickRows()) {
      const value = QUICK_DEFAULTS[row.key];
      if (typeof value === 'boolean') expect(row.kind, row.key).toBe('toggle');
      else if (typeof value === 'number') expect(row.kind, row.key).toBe('percent');
      else expect(row.kind, row.key).toBe('select');
    }
  });
  it('数值行必须带区间,且区间落在 quick-scale 的合法范围内(不造第二真源)', () => {
    const percentRows = quickRows().filter((r) => r.kind === 'percent');
    expect(percentRows).toHaveLength(3);
    for (const row of percentRows) {
      expect(row.range, row.key).toBeDefined();
      const { min, max } = row.range!;
      expect(min, row.key).toBeGreaterThanOrEqual(Math.min(STEP_MIN, OPACITY_MIN));
      expect(max, row.key).toBeLessThanOrEqual(Math.max(STEP_MAX, OPACITY_MAX));
      expect(min, row.key).toBeLessThan(max);
    }
  });
});

describe('quickResetKeys', () => {
  it('返回全部 9 个键', () => {
    expect(quickResetKeys()).toHaveLength(9);
  });
});
