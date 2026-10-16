/**
 * 四个条件补丁的纯函数用例(设计 2026-10-16 §3/§5.6,计划 T1):
 * `andAddTag`(Ctrl/⌘ 追加)、`toggleExcludeTag`(Alt 排除切换)、`onlyThisTag`(Shift 只看这条)、
 * `setTagScope`(右键「仅本级 / 含子级」)。断言都落在**值**上(用 `filterKey` / `allItems` 读),
 * 不依赖对象引用,免得实现换了组结构就假绿。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, allItems, filterKey, normalizeGroups } from '../../shared/filter-conditions';
import type { FilterConditions, FilterGroup, GroupItem, GroupOp } from '../../shared/filter-conditions';
import { andAddTag, onlyThisTag, setTagScope, toggleExcludeTag } from './tag-click-patch';

const cond = (groups: FilterGroup[], groupOp: GroupOp = 'and'): FilterConditions => ({
  ...EMPTY_FILTER,
  groupOp,
  groups,
});

const tag = (path: string, includeChildren = true): GroupItem => ({ kind: 'tag', path, includeChildren });
const exTag = (path: string, includeChildren = true): GroupItem => ({
  kind: 'excludeTag',
  path,
  includeChildren,
});

/** 全部项(归一后展平),用于值断言 */
const items = (c: FilterConditions): GroupItem[] => allItems(c);

/** 某一侧的全部路径(先判别 kind 再取 path,不做无检查断言) */
const paths = (c: FilterConditions, kind: 'tag' | 'excludeTag'): string[] =>
  items(c).flatMap((it) =>
    it.kind === kind && (it.kind === 'tag' || it.kind === 'excludeTag') ? [it.path] : []
  );

describe('andAddTag:Ctrl/⌘ = AND 追加(设计 §3.1)', () => {
  it('已在包含侧时幂等(条件对象值等价):住在非首个 and 组也不复制一份', () => {
    const cur = cond([
      { op: 'and', items: [tag('工作')] },
      { op: 'and', items: [tag('生活/旅行')] },
    ]);
    const got = andAddTag(cur, '生活/旅行');
    expect(filterKey(got)).toBe(filterKey(normalizeGroups(cur)));
    expect(paths(got, 'tag')).toEqual(['工作', '生活/旅行']);
  });

  it('落在首个 op=and 的组,且不改 groupOp(组间 op 是用户的显式结构)', () => {
    const cur = cond(
      [
        { op: 'or', items: [tag('A')] },
        { op: 'and', items: [tag('B')] },
      ],
      'or'
    );
    const got = andAddTag(cur, 'C');
    expect(got.groupOp).toBe('or');
    expect(got.groups[0].op).toBe('or');
    expect(got.groups[0].items.some((it) => it.kind === 'tag' && it.path === 'C')).toBe(false);
    expect(got.groups[1].items).toContainEqual({ kind: 'tag', path: 'C', includeChildren: true });
    expect(paths(got, 'tag')).toEqual(['A', 'B', 'C']);
  });

  it('全是 op=or 的组时追加一个 and 组(不动既有组)', () => {
    const cur = cond([{ op: 'or', items: [tag('A')] }], 'or');
    const got = andAddTag(cur, 'B');
    expect(got.groups.map((g) => g.op)).toEqual(['or', 'and']);
    expect(got.groupOp).toBe('or');
    expect(paths(got, 'tag')).toEqual(['A', 'B']);
  });

  it('从排除侧迁移到包含侧(两侧互斥)', () => {
    const cur = cond([{ op: 'and', items: [exTag('A'), tag('B')] }]);
    const got = andAddTag(cur, 'A');
    expect(paths(got, 'excludeTag')).toEqual([]);
    expect(paths(got, 'tag')).toEqual(['B', 'A']);
  });

  it('追加项恒为含子级(与侧栏点标签的既有口径一致)', () => {
    const got = andAddTag(cond([]), 'A');
    expect(items(got)).toEqual([{ kind: 'tag', path: 'A', includeChildren: true }]);
  });
});

describe('toggleExcludeTag:Alt = 排除切换(设计 §3.2)', () => {
  it('未排除 -> 排除(落第 0 组、默认含子级),再点 -> 移出', () => {
    const cur = cond([{ op: 'and', items: [tag('B')] }]);
    const once = toggleExcludeTag(cur, 'A');
    expect(paths(once, 'excludeTag')).toEqual(['A']);
    expect(once.groups[0].items).toContainEqual({
      kind: 'excludeTag',
      path: 'A',
      includeChildren: true,
    });
    const twice = toggleExcludeTag(once, 'A');
    expect(paths(twice, 'excludeTag')).toEqual([]);
    expect(paths(twice, 'tag')).toEqual(['B']);
  });

  it('从包含侧迁移时沿用仅本级口径,且包含侧不再保留该路径', () => {
    const cur = cond([{ op: 'and', items: [tag('A', false)] }]);
    const got = toggleExcludeTag(cur, 'A');
    expect(paths(got, 'tag')).toEqual([]);
    expect(items(got)).toEqual([{ kind: 'excludeTag', path: 'A', includeChildren: false }]);
  });

  it('从包含侧迁移后 Alt 再点 = 移出(Alt 切换的是排除侧,不负责把项放回包含侧)', () => {
    const cur = cond([{ op: 'and', items: [tag('A'), { kind: 'keyword', value: '天气' }] }]);
    const back = toggleExcludeTag(toggleExcludeTag(cur, 'A'), 'A');
    expect(paths(back, 'tag')).toEqual([]);
    expect(paths(back, 'excludeTag')).toEqual([]);
    expect(items(back)).toEqual([{ kind: 'keyword', value: '天气' }]);
  });
});

describe('onlyThisTag:Shift = 只看这条(设计 §3.3)', () => {
  it('清掉全部 tag/excludeTag,保留关系 / 关键词 / 表达式 / 排序 / 分组', () => {
    const cur: FilterConditions = {
      ...EMPTY_FILTER,
      groupOp: 'or',
      groups: [
        {
          op: 'and',
          items: [tag('A'), { kind: 'keyword', value: '天气' }, { kind: 'relation', path: 'R' }],
        },
        {
          op: 'or',
          items: [exTag('B'), { kind: 'expr', value: 'x > 1' }, { kind: 'presence', value: 'any' }],
        },
      ],
      sorts: [{ kind: 'time', dir: 'asc', enabled: true }],
      groupBy: { path: '生活', dir: 'desc' },
    };
    const got = onlyThisTag(cur, 'A');
    expect(paths(got, 'tag')).toEqual(['A']);
    expect(paths(got, 'excludeTag')).toEqual([]);
    // 组头保留(与「组变空也保留」口径一致),非标签项原样在
    expect(got.groups.length).toBe(2);
    expect(items(got)).toContainEqual({ kind: 'keyword', value: '天气' });
    expect(items(got)).toContainEqual({ kind: 'relation', path: 'R' });
    expect(items(got)).toContainEqual({ kind: 'expr', value: 'x > 1' });
    expect(items(got)).toContainEqual({ kind: 'presence', value: 'any' });
    expect(got.sorts).toEqual([{ kind: 'time', dir: 'asc', enabled: true }]);
    expect(got.groupBy).toEqual({ path: '生活', dir: 'desc' });
    expect(got.groupOp).toBe('or');
    expect(got.groups[0].items).toContainEqual({ kind: 'tag', path: 'A', includeChildren: true });
  });

  it('原有仅本级项保留 includeChildren=false', () => {
    const cur = cond([{ op: 'and', items: [tag('A', false), tag('B', true)] }]);
    const got = onlyThisTag(cur, 'A');
    expect(items(got)).toEqual([{ kind: 'tag', path: 'A', includeChildren: false }]);
  });

  it('没有组时新建第 0 组(空条件上 Shift 单击)', () => {
    const got = onlyThisTag({ ...EMPTY_FILTER }, 'A');
    expect(got.groups).toEqual([
      { op: 'and', items: [{ kind: 'tag', path: 'A', includeChildren: true }] },
    ]);
    expect(got.groupOp).toBe('and');
  });
});

describe('setTagScope:右键「仅本级 / 含子级」(设计 §5.6)', () => {
  it('已在包含侧就地改写(跨组也认),不新增副本', () => {
    const cur = cond([
      { op: 'and', items: [tag('A', true)] },
      { op: 'or', items: [tag('C', false)] },
    ]);
    const got = setTagScope(cur, 'C', true);
    expect(paths(got, 'tag')).toEqual(['A', 'C']);
    expect(items(got).filter((it) => it.kind === 'tag' && it.path === 'C')).toEqual([
      { kind: 'tag', path: 'C', includeChildren: true },
    ]);
    expect(got.groups[1].items).toContainEqual({ kind: 'tag', path: 'C', includeChildren: true });
    expect(got.groups[0].items).not.toContainEqual({ kind: 'tag', path: 'C', includeChildren: true });
  });

  it('不在包含侧时按该口径加入第 0 组(仅本级 / 含子级都行)', () => {
    const cur = cond([{ op: 'or', items: [tag('A')] }]);
    const selfOnly = setTagScope(cur, 'D', false);
    expect(selfOnly.groups[0].items).toContainEqual({
      kind: 'tag',
      path: 'D',
      includeChildren: false,
    });
    const subtree = setTagScope({ ...EMPTY_FILTER }, 'D', true);
    expect(subtree.groups).toEqual([
      { op: 'and', items: [{ kind: 'tag', path: 'D', includeChildren: true }] },
    ]);
  });

  it('改口径不动别的条件(filterKey 只差那一项)', () => {
    const cur = cond([{ op: 'and', items: [tag('A', true), { kind: 'keyword', value: '天气' }] }]);
    const got = setTagScope(cur, 'A', false);
    expect(items(got)).toEqual([
      { kind: 'tag', path: 'A', includeChildren: false },
      { kind: 'keyword', value: '天气' },
    ]);
  });
});
