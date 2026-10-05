/**
 * 角色建议规则与写库计划(设计 §6 / R2 / R10):
 * 规则输出(含依据文案)、角色标签缺失时静默失效、幂等过滤、写库计划的合并语义。
 */
import { describe, expect, it } from 'vitest';
import type { TagCount } from '../../shared/types';
import {
  effectiveRole,
  leaf,
  pendingSuggestions,
  planWrites,
  suggestRoles,
  SUGGESTION_RULES,
  type RoleSuggestion,
} from './role-suggestions';

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

describe('suggestRoles(启发式规则)', () => {
  it('四条规则各出建议,并带依据文案;角色名取角色标签末段', () => {
    const rows = suggestRoles(TAGS);
    expect(rows.map((r) => [r.tagPath, r.roleName, r.basis])).toEqual([
      ['作者/丸尾常喜', '作者', '来自路径 作者/*'],
      ['地点/中国', '所在', '来自路径 地点/*'],
      ['地点/日本/东京', '所在', '来自路径 地点/*'],
      ['时间/出版年份/1930', '出版年份', '时间/出版年份 下的四位年份'],
      ['状态/已完成', '状态', '来自路径 状态/*'],
    ]);
  });

  it('角色标签自身、根标签、时间/2026 与无关标签都不出建议', () => {
    const paths = suggestRoles(TAGS).map((r) => r.tagPath);
    expect(paths).not.toContain('地点');
    expect(paths).not.toContain('地点轴/所在');
    expect(paths).not.toContain('作者');
    expect(paths).not.toContain('时间/出版年份');
    expect(paths).not.toContain('时间/2026');
    expect(paths).not.toContain('知识/历史');
  });

  it('角色标签不存在时该规则静默失效(不猜 id)', () => {
    const rows = suggestRoles(TAGS.filter((t) => t.path !== '时间/出版年份'));
    expect(rows.some((r) => r.roleName === '出版年份')).toBe(false);
  });

  it('规则集中一处:四条都在 SUGGESTION_RULES 里且路径唯一', () => {
    expect(SUGGESTION_RULES.map((r) => r.rolePath)).toEqual([
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

const ROWS: RoleSuggestion[] = [
  { tagId: 2, tagPath: '地点/中国', roleTagId: 11, roleName: '所在', basis: '来自路径 地点/*' },
  { tagId: 21, tagPath: '作者/丸尾常喜', roleTagId: 20, roleName: '作者', basis: '来自路径 作者/*' },
];

describe('pendingSuggestions(幂等与忽略)', () => {
  it('已认领过该角色的行不再出现', () => {
    const claimed = new Map([[2, new Set([11])]]);
    expect(pendingSuggestions(ROWS, claimed, new Set(), new Map()).map((r) => r.tagId)).toEqual([21]);
  });

  it('认领了别的角色不算已确认,仍出现', () => {
    const claimed = new Map([[2, new Set([99])]]);
    expect(pendingSuggestions(ROWS, claimed, new Set(), new Map()).map((r) => r.tagId)).toEqual([2, 21]);
  });

  it('会话内忽略的行不再出现;改成别的角色后按改后判定', () => {
    expect(pendingSuggestions(ROWS, new Map(), new Set([2]), new Map()).map((r) => r.tagId)).toEqual([21]);
    const overrides = new Map([[2, 99]]);
    const claimed = new Map([[2, new Set([99])]]);
    expect(pendingSuggestions(ROWS, claimed, new Set(), overrides).map((r) => r.tagId)).toEqual([21]);
  });

  it('effectiveRole 优先取改后的角色', () => {
    expect(effectiveRole(ROWS[0], new Map())).toBe(11);
    expect(effectiveRole(ROWS[0], new Map([[2, 99]]))).toBe(99);
  });
});

describe('planWrites(批量写库计划)', () => {
  it('只给选中的行出写入项,并标出需先登记的角色标签', () => {
    const plan = planWrites(ROWS, new Set([21]), new Map(), new Map(), new Set([11]));
    expect(plan.registerRoleIds).toEqual([20]);
    expect(plan.writes).toEqual([{ tagId: 21, roleIds: [20] }]);
  });

  it('整体替换语义:合并该标签原有认领,不覆盖掉别的角色', () => {
    const claimed = new Map([[2, new Set([11, 7])]]);
    const plan = planWrites(ROWS, new Set([2]), new Map(), claimed, new Set([11]));
    expect(plan.writes).toEqual([{ tagId: 2, roleIds: [7, 11] }]);
    expect(plan.registerRoleIds).toEqual([]);
  });

  it('改过角色时按改后的角色写入', () => {
    const plan = planWrites(ROWS, new Set([2]), new Map([[2, 55]]), new Map([[2, new Set([11])]]), new Set([11]));
    expect(plan.writes).toEqual([{ tagId: 2, roleIds: [11, 55] }]);
    expect(plan.registerRoleIds).toEqual([55]);
  });

  it('一个都没选时不产生任何写入', () => {
    expect(planWrites(ROWS, new Set(), new Map(), new Map(), new Set())).toEqual({
      registerRoleIds: [],
      writes: [],
    });
  });
});
