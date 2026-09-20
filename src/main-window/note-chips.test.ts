import { describe, expect, it } from 'vitest';
import {
  ATTR_MAX,
  ATTR_ROOTS,
  TOPIC_MAX,
  chipRoot,
  collapseChips,
  groupChips,
} from './note-chips';

describe('chipRoot', () => {
  it('取路径首段;无分隔符时整串即根', () => {
    expect(chipRoot('日期/2026/03')).toBe('日期');
    expect(chipRoot('状态')).toBe('状态');
    expect(chipRoot('')).toBe('');
  });
});

describe('groupChips', () => {
  it('属性根按**首段**判定,不按子串(日期线 不是属性)', () => {
    expect(groupChips(['日期/2026', '日期线', '状态/待办'])).toEqual({
      topic: ['日期线'],
      attrs: ['日期/2026', '状态/待办'],
    });
  });
  it('属性根清单固定为 状态/产地/渠道/平台/作者国籍/日期', () => {
    expect(ATTR_ROOTS).toEqual(['状态', '产地', '渠道', '平台', '作者国籍', '日期']);
    const all = ATTR_ROOTS.map((r) => r + '/x');
    expect(groupChips(all).attrs).toEqual(all);
    expect(groupChips(all).topic).toEqual([]);
  });
  it('两排都保持输入顺序(不重排、不丢项)', () => {
    expect(groupChips(['追番/日漫', '产地/日本', '工作', '日期/2026'])).toEqual({
      topic: ['追番/日漫', '工作'],
      attrs: ['产地/日本', '日期/2026'],
    });
  });
  it('空标签表两排都为空', () => {
    expect(groupChips([])).toEqual({ topic: [], attrs: [] });
  });
});

describe('collapseChips', () => {
  it('不超过阈值:原样返回且 hidden 为 0', () => {
    expect(collapseChips(['a', 'b'], 2)).toEqual({ shown: ['a', 'b'], hidden: 0 });
    expect(collapseChips([], 4)).toEqual({ shown: [], hidden: 0 });
  });
  it('超过阈值:只折叠前 max 个,hidden 给出 +N 的条数(只折叠不隐藏)', () => {
    expect(collapseChips(['a', 'b', 'c', 'd'], 2)).toEqual({ shown: ['a', 'b'], hidden: 2 });
  });
  it('阈值常量:主题 6、属性 4', () => {
    expect(TOPIC_MAX).toBe(6);
    expect(ATTR_MAX).toBe(4);
  });
  it('返回值是新数组(调用方展开整排时不会改到入参)', () => {
    const list = ['a'];
    expect(collapseChips(list, 4).shown).not.toBe(list);
  });
});
