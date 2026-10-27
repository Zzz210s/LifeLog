import { describe, expect, it } from 'vitest';
import { INPUT_KEYS } from './input-settings';
import { parseSetting, SETTINGS, specOf, specsInSection } from './settings-schema';

describe('设置项单一声明', () => {
  it('键不重复', () => {
    const keys = SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('bool 的默认值只能是 true/false(否则读侧会把空串当假)', () => {
    for (const s of SETTINGS.filter((x) => x.kind === 'bool')) {
      expect(['true', 'false']).toContain(s.def);
    }
  });

  it('int 的默认值可解析成数字', () => {
    for (const s of SETTINGS.filter((x) => x.kind === 'int')) {
      expect(Number.isFinite(Number(s.def))).toBe(true);
    }
  });

  it('输入栏那一组键都在 schema 里(漏登记会让「恢复默认」漏项)', () => {
    for (const key of Object.values(INPUT_KEYS)) {
      expect(specOf(key), `未登记:${key}`).toBeDefined();
    }
  });

  it('specOf / specsInSection 按 key 与分区取', () => {
    expect(specOf('theme')?.section).toBe('appearance');
    expect(specsInSection('appearance').map((s) => s.key)).toContain('ui.search_row_height');
    expect(specsInSection('不存在')).toEqual([]);
  });
});

describe('parseSetting', () => {
  const intSpec = specOf('ui.search_row_height')!;
  const boolSpec = specOf('auto_time_tag')!;
  const jsonSpec = specOf('graph_positions')!;

  it('没存过(null)与空串都回默认值,不当 0 / 假', () => {
    expect(parseSetting(intSpec, null)).toBe(36);
    expect(parseSetting(intSpec, '')).toBe(36);
    expect(parseSetting(boolSpec, '')).toBe(true);
  });

  it('按 kind 解析', () => {
    expect(parseSetting(intSpec, '44')).toBe(44);
    expect(parseSetting(boolSpec, 'false')).toBe(false);
    expect(parseSetting(jsonSpec, '{"a":1}')).toEqual({ a: 1 });
  });

  it('坏值退回默认而不是抛', () => {
    expect(parseSetting(intSpec, 'abc')).toBe(36);
    expect(parseSetting(jsonSpec, '{bad')).toEqual({});
  });
});
