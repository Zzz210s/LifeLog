/**
 * chip 侧用例:表达式 chip 的截断 / 正文,以及 `chipsOf` 的逐来源清单与单删。
 * 摘要与 `applyTagPick` 在 `filter-chips-summary.test.ts`(拆分守 200 行红线)。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, allItems, itemPaths } from '../../shared/filter-conditions';
import { EXPR_TEXT_MAX, chipsOf, summaryOf, summaryTitleOf, truncateExpr } from './filter-chips';

const EXPR = '#工作 AND NOT #临时';

describe('表达式 chip 与摘要', () => {
  it('表达式作为一项 chip,可单独删除', () => {
    const chips = chipsOf({ ...EMPTY_FILTER, expr: EXPR });
    const chip = chips.find((c) => c.kind === 'expr')!;
    expect(chip.label).toContain('表达式');
    expect(chip.label).toBe(`表达式:${EXPR}`);
    // 删掉表达式这一项后条件为空(旧平铺字段断言在新模型下已恒真,换成组内项)
    expect(allItems(chip.remove)).toEqual([]);
  });

  it('摘要里带截断的表达式原文', () => {
    expect(summaryOf({ ...EMPTY_FILTER, expr: '#工作' })).toContain('表达式:#工作');
  });

  it('表达式过长时 chip 与摘要截断,chip title 与摘要 title 保留全文', () => {
    const long = '#工作' + ' 或 '.repeat(20) + '#生活';
    const chips = chipsOf({ ...EMPTY_FILTER, expr: long });
    const chip = chips.find((c) => c.kind === 'expr')!;
    expect(chip.label).toBe(`表达式:${truncateExpr(long)}`);
    expect(chip.label).toContain('…');
    expect(chip.title).toBe(`表达式:${long}`);
    // 摘要 title 不截断,但表达式里的标签叶子会带上 +携带(与摘要正文同口径)
    expect(summaryTitleOf({ ...EMPTY_FILTER, expr: long })).toBe(
      `表达式:#工作+携带${' 或 '.repeat(20)}#生活+携带`
    );
    expect(summaryOf({ ...EMPTY_FILTER, expr: long })).toContain('…');
  });

  it('全空白表达式不出 chip 也不进摘要', () => {
    expect(chipsOf({ ...EMPTY_FILTER, expr: '   ' })).toEqual([]);
    expect(summaryOf({ ...EMPTY_FILTER, expr: '  ' })).toBe('');
  });

  it('截断按码点计数,不把代理对劈开', () => {
    const text = '\u{1F600}'.repeat(EXPR_TEXT_MAX + 5);
    expect([...truncateExpr(text)].length).toBe(EXPR_TEXT_MAX + 1); // 含省略号
    expect(truncateExpr(text)).not.toContain('\uFFFD');
  });
});

const ASC = [{ kind: 'time', dir: 'asc', enabled: true }] as const;
const c = { ...EMPTY_FILTER, keyword: '电影', tags: [{ path: '工作', includeChildren: true }], tagPresence: 'none' as const, sort: 'oldest' as const, sorts: [...ASC] };

describe('chipsOf', () => {
  it('每个收窄来源一个 chip,标签只显路径、含子级用标记与 title 表达', () => {
    const chips = chipsOf(c);
    expect(chips.map((x) => x.label)).toEqual(['关键词:电影', '⊢ #工作', '无标签', '排序: 旧 -> 新']);
    expect(chips.find((x) => x.kind === 'tag')!.title).toBe('含子级');
    expect(chips.find((x) => x.kind === 'tag')!.label).not.toContain('含子级');
  });
  it('仅本级标签无前缀标记,title 为仅本级', () => {
    const only = chipsOf({ ...EMPTY_FILTER, tags: [{ path: '工作', includeChildren: false }] });
    expect(only[0].label).toBe('#工作');
    expect(only[0].title).toBe('仅本级');
  });
  it('删除某 chip 后条件对象不含该项', () => {
    const keywordChip = chipsOf(c).find((x) => x.kind === 'keyword')!;
    expect(allItems(keywordChip.remove).some((it) => it.kind === 'keyword')).toBe(false);
    expect(itemPaths(keywordChip.remove, 'tag')).toHaveLength(1);
  });
  it('空条件没有 chip', () => { expect(chipsOf(EMPTY_FILTER)).toEqual([]); });
});

describe('chipsOf 补充', () => {
  it('排除/有标签各一个 chip,删除后对应字段清空', () => {
    const cc = {
      ...EMPTY_FILTER,
      excludeTags: [{ path: '临时', includeChildren: false }],
      tagPresence: 'any' as const,
    };
    const chips = chipsOf(cc);
    expect(chips.map((x) => x.label)).toEqual(['排除 #临时', '有标签']);
    expect(chips.find((x) => x.kind === 'excludeTag')!.title).toBe('仅本级');
    const exclRemove = chips.find((x) => x.kind === 'excludeTag')!.remove;
    expect(itemPaths(exclRemove, 'excludeTag')).toEqual([]);
    expect(allItems(exclRemove)).toContainEqual({ kind: 'presence', value: 'any' });
    const presRemove = chips.find((x) => x.kind === 'presence')!.remove;
    expect(allItems(presRemove).some((it) => it.kind === 'presence')).toBe(false);
    expect(itemPaths(presRemove, 'excludeTag')).toEqual(['临时']);
  });
  it('日期已取消:条件对象无日期字段,自然无日期 chip', () => {
    expect(chipsOf(EMPTY_FILTER).some((x) => (x.kind as string) === 'date')).toBe(false);
    expect(Object.keys(EMPTY_FILTER)).not.toContain('from');
    expect(Object.keys(EMPTY_FILTER)).not.toContain('to');
  });
  it('排序 chip:每条启用的排序一个,文案随维度变', () => {
    expect(chipsOf({ ...EMPTY_FILTER, keyword: '   ' })).toEqual([]);
    const sorts = [
      { kind: 'tag' as const, path: '地点', dir: 'asc' as const, enabled: true },
      { kind: 'time' as const, dir: 'asc' as const, enabled: true },
    ];
    expect(chipsOf({ ...EMPTY_FILTER, sorts }).map((x) => x.label)).toEqual([
      '排序: 地点 选项顺序',
      '排序: 旧 -> 新',
    ]);
  });

  it('停用的排序不出 chip;单删只移除该项', () => {
    const sorts = [
      { kind: 'time' as const, dir: 'desc' as const, enabled: false },
      { kind: 'tag' as const, path: '地点', dir: 'asc' as const, enabled: true },
    ];
    const chips = chipsOf({ ...EMPTY_FILTER, sorts });
    expect(chips.map((x) => x.label)).toEqual(['排序: 地点 选项顺序']);
    expect(chips[0].remove.sorts).toEqual([sorts[0]]);
  });

  it('空数组(默认时间降序)不出 chip', () => {
    expect(chipsOf(EMPTY_FILTER)).toEqual([]);
  });
});
