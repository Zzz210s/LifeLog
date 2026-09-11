import { describe, expect, it } from 'vitest';
import type { Note } from '../shared/types';
import { mergeNotes, replaceNote, matchesTagFilter } from './notes-list';

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

describe('matchesTagFilter', () => {
  it('未激活任何标签时恒命中', () => {
    expect(matchesTagFilter(note(1), [])).toBe(true);
  });

  it('激活标签全部命中才保留', () => {
    const n = { ...note(1), tags: ['a', 'b'] };
    expect(matchesTagFilter(n, ['a'])).toBe(true);
    expect(matchesTagFilter(n, ['a', 'b'])).toBe(true);
  });

  it('缺任一激活标签即不命中(需从列表移除)', () => {
    const n = { ...note(1), tags: ['a'] };
    expect(matchesTagFilter(n, ['a', 'b'])).toBe(false);
    expect(matchesTagFilter(n, ['b'])).toBe(false);
  });
});
