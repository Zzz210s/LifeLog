/**
 * 类型条件的 chip 与中文摘要(spec 2026-10-05 §5 条件栏口径):
 * 显示成 `类型:国籍` 与 `标签:中国`(chip 里是 `#中国`)视觉区分。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, type FilterConditions } from '../../shared/filter-conditions';
import { applyTypePick, chipsOf, summaryOf, summaryTitleOf } from './filter-chips';
import { parseFilterState, serializeFilterState } from './filter-state';

const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });

describe('类型条件:chip 与摘要', () => {
  it('引入类型 chip 显示 类型:<路径>,摘要同样含 类型:', () => {
    const c = cond({ types: [{ path: '地点轴/国籍' }] });
    const labels = chipsOf(c).map((x) => x.label);
    expect(labels).toContain('类型:地点轴/国籍');
    expect(summaryOf(c)).toContain('类型:');
    expect(summaryOf(c)).toContain('地点轴/国籍');
    expect(summaryTitleOf(c)).toBe(summaryOf(c));
  });

  it('排除类型 chip 带 排除 前缀,摘要含排除类型', () => {
    const c = cond({ excludeTypes: [{ path: '所在' }] });
    expect(chipsOf(c).map((x) => x.label)).toContain('排除 类型:所在');
    expect(summaryOf(c)).toContain('排除 类型:所在');
  });

  it('删掉类型 chip 的条件对象里类型为空', () => {
    const chip = chipsOf(cond({ types: [{ path: '国籍' }] }))[0];
    expect(chip.remove.types).toEqual([]);
  });

  it('类型与标签可以共存,摘要里两者都在', () => {
    const c = cond({ tags: [{ path: '中国', includeChildren: true }], types: [{ path: '国籍' }] });
    const s = summaryOf(c);
    expect(s).toContain('标签');
    expect(s).toContain('中国');
    expect(s).toContain('类型:');
    expect(s).toContain('国籍');
  });
});

describe('类型条件持久化(设置写入/读回)', () => {
  it('types/excludeTypes 落库后原样读回', () => {
    const c = cond({ types: [{ path: '国籍' }], excludeTypes: [{ path: '地点轴/所在' }] });
    expect(parseFilterState(serializeFilterState(c))).toEqual(c);
    expect(serializeFilterState(c)).toContain('"types"');
  });
});

describe('applyTypePick', () => {
  it('同一类型不重复添加;排除侧独立', () => {
    const once = applyTypePick(EMPTY_FILTER, '国籍', false);
    expect(once.types).toEqual([{ path: '国籍' }]);
    expect(applyTypePick(once, '国籍', false).types).toHaveLength(1);
    expect(applyTypePick(once, '所在', true).excludeTypes).toEqual([{ path: '所在' }]);
    expect(applyTypePick(once, '所在', true).types).toHaveLength(1);
  });
});
