import { describe, expect, it } from 'vitest';
import { formatEntry, parseMonthFile, stats } from '../src/monthly/parse';

const raw = `# 2026-10

- 08:05 a #日记
- 12:00 b #地点/印度 国籍:: [[地点/日本]]
`;

describe('parseMonthFile', () => {
  const es = parseMonthFile('拾枝/2026-10.md', raw);
  it('解析出两条，时间与正文分开', () => {
    expect(es).toHaveLength(2);
    expect(es[0].time).toBe('08:05');
    expect(es[0].text).toBe('a');
    expect(es[1].tags).toEqual(['地点/印度']);
    expect(es[1].rels).toEqual([{ name: '国籍', to: '地点/日本' }]);
    expect(es[1].text).toBe('b');
  });
  it('非条目行不算', () => {
    expect(parseMonthFile('x/2026-10.md', '# 2026-10\n\n正文普通段落\n')).toHaveLength(0);
  });
});

describe('formatEntry 与解析对称', () => {
  it('解析→格式化→再解析 一致', () => {
    const line = formatEntry('12:00', 'b', ['地点/印度'], [{ name: '国籍', to: '地点/日本' }]);
    const back = parseMonthFile('x/2026-10.md', `# 2026-10\n${line}\n`);
    expect(back[0].text).toBe('b');
    expect(back[0].tags).toEqual(['地点/印度']);
    expect(back[0].rels[0].to).toBe('地点/日本');
  });
});

describe('stats', () => {
  it('Top 标签、小时分布、月份计数', () => {
    const es = parseMonthFile('拾枝/2026-10.md', raw);
    const s = stats(es);
    expect(s.byHour[8]).toBe(1);
    expect(s.byHour[12]).toBe(1);
    expect(s.byMonth).toEqual([['2026-10', 2]]);
    expect(s.topTags[0][0]).toBeDefined();
  });
});
