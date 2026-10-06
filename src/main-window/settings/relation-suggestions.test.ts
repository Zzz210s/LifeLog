/**
 * 关系建议规则与写库计划(标签关系统一 spec §9,规则沿用标签类型建议):
 * 规则输出(含依据文案)、目标标签缺失时静默失效、幂等过滤、写库计划的增量语义。
 */
import { describe, expect, it } from 'vitest';
import type { TagCount } from '../../shared/types';
import {
  effectiveTarget,
  leaf,
  pendingSuggestions,
  planWrites,
  setExcludedFor,
  suggestRelations,
  SUGGESTION_RULES,
  type RelationSuggestion,
} from './relation-suggestions';

const tag = (id: number, path: string): TagCount => ({
  id,
  path,
  depth: path.split('/').length,
  sort_order: id,
  self_count: 0,
  subtree_count: 0,
});

const TAGS: TagCount[] = [
  tag(1, '地点'),
  tag(2, '地点/中国'),
  tag(3, '地点/日本/东京'),
  tag(10, '地点轴'),
  tag(11, '地点轴/所在'),
  tag(20, '作者'),
  tag(21, '作者/丸尾常喜'),
  tag(30, '时间'),
  tag(31, '时间/出版年份'),
  tag(32, '时间/出版年份/1930'),
  tag(33, '时间/2026'),
  tag(40, '状态'),
  tag(41, '状态/已完成'),
  tag(50, '知识'),
  tag(51, '知识/历史'),
];

describe('suggestRelations(启发式规则)', () => {
  it('四条规则各出建议,并带依据文案;目标名取目标标签末段', () => {
    const rows = suggestRelations(TAGS);
    expect(rows.map((r) => [r.tagPath, r.toName, r.basis])).toEqual([
      ['作者/丸尾常喜', '作者', '来自路径 作者/*'],
      ['地点/中国', '所在', '来自路径 地点/*'],
      ['地点/日本/东京', '所在', '来自路径 地点/*'],
      ['时间/出版年份/1930', '出版年份', '时间/出版年份 下的四位年份'],
      ['状态/已完成', '状态', '来自路径 状态/*'],
    ]);
  });

  it('目标标签自身、根标签、时间/2026 与无关标签都不出建议', () => {
    const paths = suggestRelations(TAGS).map((r) => r.tagPath);
    expect(paths).not.toContain('地点');
    expect(paths).not.toContain('地点轴/所在');
    expect(paths).not.toContain('作者');
    expect(paths).not.toContain('时间/出版年份');
    expect(paths).not.toContain('时间/2026');
    expect(paths).not.toContain('知识/历史');
  });

  it('目标标签不存在时该规则静默失效(不猜 id)', () => {
    const rows = suggestRelations(TAGS.filter((t) => t.path !== '时间/出版年份'));
    expect(rows.some((r) => r.toName === '出版年份')).toBe(false);
  });

  it('规则集中一处:四条都在 SUGGESTION_RULES 里且路径唯一', () => {
    expect(SUGGESTION_RULES.map((r) => r.toPath)).toEqual([
      '地点轴/所在',
      '作者',
      '时间/出版年份',
      '状态',
    ]);
  });

  it('leaf 取路径末段', () => {
    expect(leaf('地点轴/所在')).toBe('所在');
    expect(leaf('作者')).toBe('作者');
  });
});

const ROWS: RelationSuggestion[] = [
  { tagId: 2, tagPath: '地点/中国', toTagId: 11, toName: '所在', basis: '来自路径 地点/*' },
  { tagId: 21, tagPath: '作者/丸尾常喜', toTagId: 20, toName: '作者', basis: '来自路径 作者/*' },
];

describe('pendingSuggestions(幂等与忽略)', () => {
  it('已建立该关系的行不再出现', () => {
    const existing = new Map([[2, new Set([11])]]);
    expect(pendingSuggestions(ROWS, existing, new Set(), new Map()).map((r) => r.tagId)).toEqual([21]);
  });

  it('建立了别的目标不算已确认,仍出现', () => {
    const existing = new Map([[2, new Set([99])]]);
    expect(pendingSuggestions(ROWS, existing, new Set(), new Map()).map((r) => r.tagId)).toEqual([2, 21]);
  });

  it('会话内忽略的行不再出现;改成别的目标后按改后判定', () => {
    expect(pendingSuggestions(ROWS, new Map(), new Set([2]), new Map()).map((r) => r.tagId)).toEqual([21]);
    const overrides = new Map([[2, 99]]);
    const existing = new Map([[2, new Set([99])]]);
    expect(pendingSuggestions(ROWS, existing, new Set(), overrides).map((r) => r.tagId)).toEqual([21]);
  });

  it('effectiveTarget 优先取改后的目标', () => {
    expect(effectiveTarget(ROWS[0], new Map())).toBe(11);
    expect(effectiveTarget(ROWS[0], new Map([[2, 99]]))).toBe(99);
  });
});

describe('planWrites(批量写库计划)', () => {
  it('只给选中的行出写入项', () => {
    const plan = planWrites(ROWS, new Set([21]), new Map());
    expect(plan.writes).toEqual([{ fromId: 21, toId: 20 }]);
  });

  it('增量语义:一条建议 = 一条边,不整体替换该标签已有的别的边', () => {
    const plan = planWrites(ROWS, new Set([2]), new Map());
    expect(plan.writes).toEqual([{ fromId: 2, toId: 11 }]);
  });

  it('改过目标时按改后的目标写入', () => {
    const plan = planWrites(ROWS, new Set([2]), new Map([[2, 55]]));
    expect(plan.writes).toEqual([{ fromId: 2, toId: 55 }]);
  });

  it('一个都没选时不产生任何写入', () => {
    expect(planWrites(ROWS, new Set(), new Map())).toEqual({ writes: [] });
  });
});

describe('批量勾选(只作用于给定行)', () => {
  it('加/删只动给定 id,集合里其它行原样保留,且不改原集合', () => {
    const before = new Set([1, 2, 3]);
    expect([...setExcludedFor(before, [2, 9], true)].sort((a, b) => a - b)).toEqual([1, 2, 3, 9]);
    expect([...setExcludedFor(before, [1, 3], false)]).toEqual([2]);
    expect([...before]).toEqual([1, 2, 3]);
  });
});
