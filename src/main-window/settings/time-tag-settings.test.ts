import { describe, expect, it } from 'vitest';
import {
  AUTO_TIME_TAG_KEY,
  DEFAULT_TIME_TAG_TEMPLATE,
  TIME_TAG_TEMPLATE_KEY,
  normalizeTemplate,
  parseAutoTimeTag,
  templateVerdict,
} from './time-tag-settings';

describe('设置键与默认值(与 Rust 侧一致)', () => {
  it('键名与迁移 011 登记的键一致', () => {
    expect(AUTO_TIME_TAG_KEY).toBe('auto_time_tag');
    expect(TIME_TAG_TEMPLATE_KEY).toBe('time_tag_template');
  });

  it('默认模板与 Rust timetag::DEFAULT_TEMPLATE 一致', () => {
    expect(DEFAULT_TIME_TAG_TEMPLATE).toBe('时间排序/{y}/{m}/{d}');
  });
});

describe('parseAutoTimeTag(默认开)', () => {
  it('缺失或非法值一律回默认 true', () => {
    expect(parseAutoTimeTag(null)).toBe(true);
    expect(parseAutoTimeTag('')).toBe(true);
    expect(parseAutoTimeTag('TRUE')).toBe(true);
    expect(parseAutoTimeTag('true')).toBe(true);
  });

  it('只有显式 false 才算关', () => {
    expect(parseAutoTimeTag('false')).toBe(false);
  });
});

describe('normalizeTemplate(空值回默认)', () => {
  it('缺失/空串/纯空白回默认模板', () => {
    expect(normalizeTemplate(null)).toBe(DEFAULT_TIME_TAG_TEMPLATE);
    expect(normalizeTemplate('')).toBe(DEFAULT_TIME_TAG_TEMPLATE);
    expect(normalizeTemplate('   ')).toBe(DEFAULT_TIME_TAG_TEMPLATE);
  });

  it('用户改过的值原样保留(不 trim,交给后端校验)', () => {
    expect(normalizeTemplate('日期/{y}/{m}/{d}')).toBe('日期/{y}/{m}/{d}');
    expect(normalizeTemplate(' 日期/{y}/{m}/{d} ')).toBe(' 日期/{y}/{m}/{d} ');
  });
});

describe('templateVerdict(模板校验接线:非法不落库)', () => {
  it('后端校验通过:落库并提示已保存', () => {
    expect(templateVerdict(null)).toEqual({ save: true, message: '模板合法,已保存' });
  });

  it('后端给中文原因:不落库,提示里带上原因', () => {
    const v = templateVerdict('模板必须包含 {y}');
    expect(v.save).toBe(false);
    expect(v.message).toContain('模板必须包含 {y}');
    expect(v.message).toContain('未保存');
    expect(templateVerdict('模板生成的标签路径不合法(x)').message).toContain('不合法');
  });
});
