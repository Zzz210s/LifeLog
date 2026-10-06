/**
 * 关系条件的 chip 与中文摘要(设计 2026-10-06 §10 R10b):
 * 显示成 `关系:国籍`,与 `标签` 的 `#中国` 视觉区分;命中数小字照旧。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, type FilterConditions } from '../../shared/filter-conditions';
import { applyRelationPick, chipsOf, summaryOf, summaryTitleOf } from './filter-chips';
import { parseFilterState, serializeFilterState } from './filter-state';

const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });

describe('关系条件:chip 与摘要', () => {
  it('引入关系 chip 显示 关系:<路径>,摘要同样含 关系:', () => {
    const c = cond({ relations: [{ path: '地点轴/国籍' }] });
    const labels = chipsOf(c).map((x) => x.label);
    expect(labels).toContain('关系:地点轴/国籍');
    expect(summaryOf(c)).toContain('关系:');
    expect(summaryOf(c)).toContain('地点轴/国籍');
    expect(summaryTitleOf(c)).toBe(summaryOf(c));
  });

  it('排除关系 chip 带 排除 前缀,摘要含排除 关系', () => {
    const c = cond({ excludeRelations: [{ path: '所在' }] });
    expect(chipsOf(c).map((x) => x.label)).toContain('排除 关系:所在');
    expect(summaryOf(c)).toContain('排除 关系:所在');
  });

  it('删掉关系 chip 的条件对象里关系为空', () => {
    const chip = chipsOf(cond({ relations: [{ path: '国籍' }] }))[0];
    expect(chip.remove.relations).toEqual([]);
  });

  it('关系与标签可以共存,摘要里两者都在', () => {
    const c = cond({ tags: [{ path: '中国', includeChildren: true }], relations: [{ path: '国籍' }] });
    const s = summaryOf(c);
    expect(s).toContain('标签');
    expect(s).toContain('中国');
    expect(s).toContain('关系:');
    expect(s).toContain('国籍');
  });
});

describe('关系条件持久化(设置写入/读回)', () => {
  it('relations/excludeRelations 落库后原样读回;旧字段名存量条件也读回', () => {
    const c = cond({ relations: [{ path: '国籍' }], excludeRelations: [{ path: '地点轴/所在' }] });
    expect(parseFilterState(serializeFilterState(c))).toEqual(c);
    const raw = serializeFilterState(c);
    expect(raw).toContain('"relations"');
    expect(raw).not.toContain('"types"');
    expect(parseFilterState('{"types":[{"path":"国籍"}]}').relations).toEqual([{ path: '国籍' }]);
  });
});

describe('applyRelationPick', () => {
  it('同一关系不重复添加;排除侧独立', () => {
    const once = applyRelationPick(EMPTY_FILTER, '国籍', false);
    expect(once.relations).toEqual([{ path: '国籍' }]);
    expect(applyRelationPick(once, '国籍', false).relations).toHaveLength(1);
    expect(applyRelationPick(once, '所在', true).excludeRelations).toEqual([{ path: '所在' }]);
    expect(applyRelationPick(once, '所在', true).relations).toHaveLength(1);
  });
});
