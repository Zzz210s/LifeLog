/**
 * 角色条件的 chip 与中文摘要(spec 2026-10-05 §5 条件栏口径):
 * 显示成 `角色:国籍` 与 `标签:中国`(chip 里是 `#中国`)视觉区分。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, type FilterConditions } from '../../shared/filter-conditions';
import { applyRolePick, chipsOf, summaryOf, summaryTitleOf } from './filter-chips';
import { parseFilterState, serializeFilterState } from './filter-state';

const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });

describe('角色条件:chip 与摘要', () => {
  it('引入角色 chip 显示 角色:<路径>,摘要同样含 角色:', () => {
    const c = cond({ roles: [{ path: '地点轴/国籍' }] });
    const labels = chipsOf(c).map((x) => x.label);
    expect(labels).toContain('角色:地点轴/国籍');
    expect(summaryOf(c)).toContain('角色:');
    expect(summaryOf(c)).toContain('地点轴/国籍');
    expect(summaryTitleOf(c)).toBe(summaryOf(c));
  });

  it('排除角色 chip 带 排除 前缀,摘要含排除角色', () => {
    const c = cond({ excludeRoles: [{ path: '所在' }] });
    expect(chipsOf(c).map((x) => x.label)).toContain('排除 角色:所在');
    expect(summaryOf(c)).toContain('排除 角色:所在');
  });

  it('删掉角色 chip 的条件对象里角色为空', () => {
    const chip = chipsOf(cond({ roles: [{ path: '国籍' }] }))[0];
    expect(chip.remove.roles).toEqual([]);
  });

  it('角色与标签可以共存,摘要里两者都在', () => {
    const c = cond({ tags: [{ path: '中国', includeChildren: true }], roles: [{ path: '国籍' }] });
    const s = summaryOf(c);
    expect(s).toContain('标签');
    expect(s).toContain('中国');
    expect(s).toContain('角色:');
    expect(s).toContain('国籍');
  });
});

describe('角色条件持久化(设置写入/读回)', () => {
  it('roles/excludeRoles 落库后原样读回', () => {
    const c = cond({ roles: [{ path: '国籍' }], excludeRoles: [{ path: '地点轴/所在' }] });
    expect(parseFilterState(serializeFilterState(c))).toEqual(c);
    expect(serializeFilterState(c)).toContain('"roles"');
  });
});

describe('applyRolePick', () => {
  it('同一角色不重复添加;排除侧独立', () => {
    const once = applyRolePick(EMPTY_FILTER, '国籍', false);
    expect(once.roles).toEqual([{ path: '国籍' }]);
    expect(applyRolePick(once, '国籍', false).roles).toHaveLength(1);
    expect(applyRolePick(once, '所在', true).excludeRoles).toEqual([{ path: '所在' }]);
    expect(applyRolePick(once, '所在', true).roles).toHaveLength(1);
  });
});
