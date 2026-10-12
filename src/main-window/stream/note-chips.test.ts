import { describe, expect, it } from 'vitest';
import { CHIP_MAX, collapseAncestors, collapseChips } from './note-chips';

describe('collapseChips', () => {
  it('不超过阈值:原样返回且 hidden 为 0', () => {
    expect(collapseChips(['a', 'b'], 2)).toEqual({ shown: ['a', 'b'], hidden: 0 });
    expect(collapseChips([], 4)).toEqual({ shown: [], hidden: 0 });
  });
  it('超过阈值:只折叠前 max 个,hidden 给出 +N 的条数(只折叠不隐藏)', () => {
    expect(collapseChips(['a', 'b', 'c', 'd'], 2)).toEqual({ shown: ['a', 'b'], hidden: 2 });
  });
  it('阈值常量:单排 10(原「主题 6 + 属性 4」两排额度之和)', () => {
    expect(CHIP_MAX).toBe(10);
  });
  it('返回值是新数组(调用方展开整排时不会改到入参)', () => {
    const list = ['a'];
    expect(collapseChips(list, 4).shown).not.toBe(list);
  });
});

describe('collapseAncestors(子蕴含父的显示层去重)', () => {
  it('祖先与后代同时在集合里时,只留后代', () => {
    expect(collapseAncestors(['信息', '信息/本科'])).toEqual(['信息/本科']);
    expect(collapseAncestors(['电影', '电影/真人'])).toEqual(['电影/真人']);
    // 三层:只留最深的一支
    expect(collapseAncestors(['a', 'a/b', 'a/b/c'])).toEqual(['a/b/c']);
    // 无祖先关系时原样保留,且保持输入顺序
    expect(collapseAncestors(['日记', '日期/2026/09/20'])).toEqual(['日记', '日期/2026/09/20']);
    expect(collapseAncestors(['电影/真人', '信息/本科'])).toEqual(['电影/真人', '信息/本科']);
    // 前缀相似但不是层级(电影 vs 电影院)不能误删
    expect(collapseAncestors(['电影', '电影院'])).toEqual(['电影', '电影院']);
  });
});
