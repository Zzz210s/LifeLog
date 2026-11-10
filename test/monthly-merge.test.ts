import { describe, expect, it } from 'vitest';
import { clock, mergeToMonths, monthKey, toLine, worthMigrating } from '../src/monthly/merge';

const n = (created: string, body: string, tags: string[] = [], rels: { name: string; to: string }[] = []) => ({
  path: `x/${created}.md`,
  created,
  body,
  tags,
  rels,
});

describe('monthKey / clock', () => {
  it('取年月与时间', () => {
    expect(monthKey('2026-10-26 12:01:32')).toBe('2026-10');
    expect(clock('2026-10-26 12:01:32')).toBe('12:01');
  });
  it('脏数据不炸', () => {
    expect(monthKey('')).toBe('0000-00');
    expect(clock('无时间')).toBe('00:00');
  });
});

describe('toLine', () => {
  it('正文 + 标签 + 命名关系拼一行', () => {
    expect(toLine(n('2026-10-26 12:01:00', '办驾照  ', ['地点/印度'], [{ name: '国籍', to: '地点/日本' }]))).toBe(
      '- 12:01 办驾照 #地点/印度 国籍:: [[地点/日本]]',
    );
  });
  it('标签自带 # 不重复加', () => {
    expect(toLine(n('2026-10-26 09:00:00', 'x', ['#日记']))).toBe('- 09:00 x #日记');
  });
});

describe('mergeToMonths', () => {
  const notes = [
    n('2026-10-26 12:00:00', 'b', ['日记']),
    n('2026-10-02 08:00:00', 'a'),
    n('2026-09-30 23:59:00', 'c'),
  ];
  const files = mergeToMonths(notes, '拾枝');

  it('按年月切文件，月内按时间升序', () => {
    expect(files.map((f) => f.path)).toEqual(['拾枝/2026-09.md', '拾枝/2026-10.md']);
    const oct = files[1];
    expect(oct.count).toBe(2);
    expect(oct.content.indexOf('a')).toBeLessThan(oct.content.indexOf('b'));
  });

  it('文件头是 # 年-月，行以 - HH:MM 开头', () => {
    expect(files[1].content.startsWith('# 2026-10\n')).toBe(true);
    expect(files[1].content).toContain('- 08:00 a');
  });
});

describe('worthMigrating', () => {
  it('空条目跳过', () => {
    expect(worthMigrating(n('2026-10-26 00:00:00', '   '))).toBe(false);
    expect(worthMigrating(n('2026-10-26 00:00:00', '', ['a']))).toBe(true);
  });
});
