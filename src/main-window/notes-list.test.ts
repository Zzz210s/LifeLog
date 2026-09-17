import { describe, expect, it } from 'vitest';
import type { Note } from '../shared/types';
import { EMPTY_FILTER } from '../shared/filter-conditions';
import { matchesTagsByPath } from '../shared/filter-conditions-local';
import { mergeNotes, replaceNote, needsRefetchAfterChange, shouldAutoRefresh, PAGE } from './notes-list';

const note = (id: number, content = 'x'): Note => ({
  id,
  content,
  created_at: '2026-09-12 08:30:45',
  tags: [],
});

describe('mergeNotes', () => {
  it('追加新页并保持原顺序', () => {
    expect(mergeNotes([note(3), note(2)], [note(1)]).map((n) => n.id)).toEqual([3, 2, 1]);
  });

  it('过滤与上一页重复的 id(调用方的页与页交叠)', () => {
    expect(mergeNotes([note(3), note(2)], [note(2), note(1)]).map((n) => n.id)).toEqual([
      3, 2, 1,
    ]);
  });

  it('上一页为空时直接返回新页', () => {
    expect(mergeNotes([], [note(1)]).map((n) => n.id)).toEqual([1]);
  });
});

describe('replaceNote', () => {
  it('替换同 id 且保持位置', () => {
    const out = replaceNote([note(3), note(2), note(1)], note(2, '新内容'));
    expect(out.map((n) => n.id)).toEqual([3, 2, 1]);
    expect(out[1]?.content).toBe('新内容');
  });

  it('id 不在列表中原样返回', () => {
    const prev = [note(1)];
    expect(replaceNote(prev, note(9))).toEqual(prev);
  });
});

describe('needsRefetchAfterChange', () => {
  it('keyword 非空:一律重查首页(本地判不了命中与排序)', () => {
    expect(needsRefetchAfterChange('苹果')).toBe(true);
    expect(needsRefetchAfterChange('  苹果  ')).toBe(true);
  });

  it('keyword 为空:不重查,由就地更新/本地移除完成', () => {
    expect(needsRefetchAfterChange('')).toBe(false);
    expect(needsRefetchAfterChange('   ')).toBe(false);
  });

  it('判定与变更后是否命中标签筛选无关(无关键词时不因失配而重查)', () => {
    const hit = { ...note(1, '苹果 好吃'), tags: ['水果'] };
    const missTag = { ...note(1, '苹果 好吃'), tags: ['其他'] };
    const condOf = (...tags: string[]) => ({
      ...EMPTY_FILTER,
      tags: tags.map((path) => ({ path, includeChildren: false })),
    });
    const decide = (n: Note, keyword: string, tags: string[]) =>
      needsRefetchAfterChange(keyword) ? 'refetch' : matchesTagsByPath(n, condOf(...tags)) ? 'in-place' : 'remove';
    expect(decide(hit, '', ['水果'])).toBe('in-place');
    expect(decide(missTag, '', ['水果'])).toBe('remove');
    expect(decide(hit, '苹果', ['水果'])).toBe('refetch');
  });
});

describe('shouldAutoRefresh', () => {
  it('未翻页且未编辑:自动刷新', () => {
    expect(shouldAutoRefresh(0, null)).toBe(true);
    expect(shouldAutoRefresh(PAGE - 1, null)).toBe(true);
    expect(shouldAutoRefresh(PAGE, null)).toBe(true);
  });

  it('已翻页(超过首页容量):不刷新,避免把滚动位置弹回顶部', () => {
    expect(shouldAutoRefresh(PAGE + 1, null)).toBe(false);
    expect(shouldAutoRefresh(PAGE * 2, null)).toBe(false);
  });

  it('编辑态:不刷新,避免卸载 EditPanel 丢弃未保存文本', () => {
    expect(shouldAutoRefresh(0, 7)).toBe(false);
    expect(shouldAutoRefresh(PAGE, 7)).toBe(false);
  });
});
