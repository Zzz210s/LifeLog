import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { TITLE_KEYWORD_MAX, autoTitle } from './auto-title';

const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });
const tags = (path: string) => [{ path, includeChildren: true }];

describe('autoTitle(标签页自动标题,S7 纯函数)', () => {
  it('没有任何收窄条件 -> 全部;最早在前单独成段', () => {
    expect(autoTitle(EMPTY_FILTER)).toBe('全部');
    expect(autoTitle(cond({ sort: 'oldest' }))).toBe('全部 · 最早在前');
  });

  it('标签条件带上排序段(spec 示例 `#待办 · 最新在前`)', () => {
    expect(autoTitle(cond({ tags: tags('待办') }))).toBe('#待办 · 最新在前');
    expect(autoTitle(cond({ tags: tags('待办'), sort: 'oldest' }))).toBe('#待办 · 最早在前');
    expect(autoTitle(cond({ tags: tags('工作/项目A') }))).toBe('#工作/项目A · 最新在前');
  });

  it('纯关键词/纯有无标签保持简短(spec 示例)', () => {
    expect(autoTitle(cond({ keyword: '减肥' }))).toBe('关键词「减肥」');
    expect(autoTitle(cond({ tagPresence: 'none' }))).toBe('无标签');
    expect(autoTitle(cond({ tagPresence: 'any' }))).toBe('有标签');
    expect(autoTitle(cond({ keyword: '减肥', sort: 'oldest' }))).toBe('关键词「减肥」 · 最早在前');
  });

  it('关键词超长按码点截断(不影响查询,只影响标题)', () => {
    const long = '减'.repeat(TITLE_KEYWORD_MAX + 3);
    expect(autoTitle(cond({ keyword: long }))).toBe(`关键词「${'减'.repeat(TITLE_KEYWORD_MAX)}…」`);
    // 代理对字符(增补平面汉字)按 1 个字符计,不切坏
    const wide = '𠮷'.repeat(TITLE_KEYWORD_MAX + 1);
    expect(autoTitle(cond({ keyword: wide }))).toBe(`关键词「${'𠮷'.repeat(TITLE_KEYWORD_MAX)}…」`);
  });

  it('排除标签 / 表达式 / 组合条件按固定段顺序拼接', () => {
    expect(autoTitle(cond({ excludeTags: tags('工作') }))).toBe('排除 #工作 · 最新在前');
    expect(autoTitle(cond({ expr: '#工作' }))).toBe('表达式 · 最新在前');
    expect(autoTitle(cond({ expr: '   ' }))).toBe('全部');
    expect(autoTitle(cond({ keyword: ' 减肥 ', tags: tags('健康') }))).toBe(
      '#健康 · 关键词「减肥」 · 最新在前'
    );
  });
});
