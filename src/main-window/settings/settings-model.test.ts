import { describe, expect, it } from 'vitest';
import { INPUT_DEFAULTS } from '../../shared/input-settings';
import { OPACITY_MAX, OPACITY_MIN, STEP_MAX, STEP_MIN } from '../../shared/input-scale';
import { STARTUP_SHOW_VALUES } from '../../shared/startup-settings';
import { inputResetKeys, inputRows, startupRows } from './settings-model';

describe('inputRows', () => {
  it('恰好 9 项且顺序与设计一致', () => {
    expect(inputRows().map((r) => r.key)).toEqual([
      'alwaysOnTop', 'hideOnBlur', 'zoomStep', 'defaultOpacity', 'opacityStep',
      'lockMove', 'lockClose', 'lockContent', 'doubleClickAction',
    ]);
  });
  it('每项都有中文标签与说明', () => {
    for (const r of inputRows()) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.hint.length).toBeGreaterThan(0);
    }
  });
  it('双击动作为下拉且有两项', () => {
    const row = inputRows().find((r) => r.key === 'doubleClickAction')!;
    expect(row.kind).toBe('select');
    expect(row.options?.map((o) => o.value)).toEqual(['hide', 'none']);
  });
  // kind 是控件分派的唯一依据:错标会把布尔项渲染成百分比输入(或反之),
  // 且不会报错、只会静默改错值。故用 INPUT_DEFAULTS 的运行时类型逐行交叉校验。
  it('每行 kind 与字段默认值的类型一致', () => {
    for (const row of inputRows()) {
      const value = INPUT_DEFAULTS[row.key];
      if (typeof value === 'boolean') expect(row.kind, row.key).toBe('toggle');
      else if (typeof value === 'number') expect(row.kind, row.key).toBe('percent');
      else expect(row.kind, row.key).toBe('select');
    }
  });
  it('数值行必须带区间,且区间落在 input-scale 的合法范围内(不造第二真源)', () => {
    const percentRows = inputRows().filter((r) => r.kind === 'percent');
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

describe('inputResetKeys', () => {
  it('返回全部 9 个键', () => {
    expect(inputResetKeys()).toHaveLength(9);
  });
});

describe('startupRows', () => {
  it('两行:开机启动开关 + 启动显示下拉', () => {
    expect(startupRows().map((r) => r.key)).toEqual(['autostart', 'startupShow']);
    expect(startupRows()[0].kind).toBe('toggle');
    const show = startupRows()[1];
    expect(show.kind).toBe('select');
    // 白名单必须与解析函数的回退口径一致(值域只有这两项,否则会被 parseStartupSettings 回退默认)
    expect(show.options?.map((o) => o.value)).toEqual(STARTUP_SHOW_VALUES);
  });
});
