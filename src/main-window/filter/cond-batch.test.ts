/**
 * 条件条目批量编辑的纯逻辑(方案 A,spec 2026-10-17 §A):四个动作各一条 + 非标签项不可动 +
 * 混合两侧的方向二义 + 落库后条件项数与 chip 数一致。所有函数不碰 React、不碰 IPC。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, itemPaths, normalizeGroups, uiGroups } from '../../shared/filter-conditions';
import type { FilterConditions, GroupItem } from '../../shared/filter-conditions';
import { chipsOf } from './filter-chips';
import { serializeFilterState } from './filter-state';
import {
  allCondSelected,
  condGate,
  condKeys,
  reselectKeys,
  selectedOf,
  toggleCondKey,
} from './cond-batch';
import {
  deleteSelected,
  moveSideSelected,
  setChildrenSelected,
  wrapSelected,
} from './cond-batch-actions';

const tag = (path: string, includeChildren = true): GroupItem => ({ kind: 'tag', path, includeChildren });
const exTag = (path: string, includeChildren = true): GroupItem => ({
  kind: 'excludeTag',
  path,
  includeChildren,
});
const kw = (value: string): GroupItem => ({ kind: 'keyword', value });

/** 造条件:每组一项列表(组内恒 and,便于按位置索引) */
const cond = (groupOp: 'and' | 'or', ...groups: GroupItem[][]): FilterConditions => ({
  ...EMPTY_FILTER,
  groupOp,
  groups: groups.map((items) => ({ op: 'and' as const, items })),
});

const kindsOf = (c: FilterConditions): string[] => uiGroups(c).flatMap((g) => g.items.map((it) => it.kind));
const itemsOf = (c: FilterConditions): GroupItem[] => uiGroups(c).flatMap((g) => g.items);

describe('位置键与全选', () => {
  it('条目身份 = (组下标, 组内下标);全选覆盖全部条件项', () => {
    const c = cond('and', [tag('工作'), kw('x')], [exTag('临时')]);
    expect(condKeys(c)).toEqual(['0:0', '0:1', '1:0']);
    expect(allCondSelected(new Set(['0:0', '0:1', '1:0']), condKeys(c))).toBe(true);
    expect(allCondSelected(new Set(['0:0']), condKeys(c))).toBe(false);
    // 空条件没有可全选的东西(按钮不该变成「取消全选」)
    expect(allCondSelected(new Set(), [])).toBe(false);
    expect([...toggleCondKey(new Set(['0:0']), '0:1')]).toEqual(['0:0', '0:1']);
    expect([...toggleCondKey(new Set(['0:0', '0:1']), '0:1')]).toEqual(['0:0']);
  });

  it('选中键按位置解析回项;失效键被忽略(不越界、不抛)', () => {
    const c = cond('and', [tag('工作')]);
    expect(selectedOf(c, new Set(['0:0', '9:9'])).map((s) => s.item.kind)).toEqual(['tag']);
  });

  it('挪位的动作之后按身份重认选中(路径认路径):移动到另一侧 / 移入新组都能接着做下一个动作', () => {
    const c = cond('and', [kw('x')], [tag('工作', true), tag('生活', false)]);
    const sel = new Set(['1:0', '1:1']);
    const moved = moveSideSelected(c, sel, 'exclude');
    const afterMove = reselectKeys(moved, selectedOf(c, sel).map((s) => s.item));
    // 两项被搬到第 0 组末尾 —— 选中的就是它们(位置变了,身份没变)
    expect([...afterMove]).toEqual(['0:1', '0:2']);
    expect(selectedOf(moved, afterMove).map((s) => `${s.item.kind}:${(s.item as { path: string }).path}`))
      .toEqual(['excludeTag:工作', 'excludeTag:生活']);
    const wrapped = wrapSelected(moved, afterMove);
    const afterWrap = reselectKeys(wrapped, selectedOf(moved, afterMove).map((s) => s.item));
    // 新组追加在末尾(空组仍留组头,所以下标可能是 2 而非 1);关键是两项仍被选中且身份不变
    expect(selectedOf(wrapped, afterWrap).map((s) => `${s.item.kind}:${(s.item as { path: string }).path}`))
      .toEqual(['excludeTag:工作', 'excludeTag:生活']);
    expect(afterWrap.size).toBe(2);
  });

  it('重认不会把同一项认领两次(先到先得)', () => {
    const c = cond('and', [tag('a'), tag('a')]);
    expect([...reselectKeys(c, [tag('a'), tag('a')])]).toEqual(['0:0', '0:1']);
    expect([...reselectKeys(c, [tag('a'), tag('b')])]).toEqual(['0:0']);
  });
});

describe('四个动作', () => {
  it('删除选中:删掉这些项;空组在纯函数里保留组头,落库归一才丢弃(与单条 × 删除同一口径)', () => {
    const c = cond('and', [tag('工作'), kw('x'), tag('生活')]);
    const next = deleteSelected(c, new Set(['0:0', '0:2']));
    expect(kindsOf(next)).toEqual(['keyword']);
    // 落库读数:normalizeGroups / serialize 都丢掉空组 —— 既有单条 × 删除走的就是这条
    const emptied = deleteSelected(cond('and', [tag('工作')]), new Set(['0:0']));
    expect(normalizeGroups(emptied).groups).toEqual([]);
    expect(JSON.parse(serializeFilterState(emptied)).groups).toEqual([]);
  });

  it('含子级 ⇄ 仅本级:就地改写选中标签项,未选中的原样', () => {
    const c = cond('and', [tag('工作', true), exTag('临时', true), tag('生活', true)]);
    const next = setChildrenSelected(c, new Set(['0:0', '0:1']), false);
    expect(itemsOf(next)).toEqual([
      { kind: 'tag', path: '工作', includeChildren: false },
      { kind: 'excludeTag', path: '临时', includeChildren: false },
      { kind: 'tag', path: '生活', includeChildren: true },
    ]);
    // 反向:仅本级 -> 含子级
    const back = setChildrenSelected(next, new Set(['0:0']), true);
    expect(itemsOf(back)[0]).toMatchObject({ includeChildren: true });
  });

  it('移到排除侧:选中项变 excludeTag 并恒落第 0 组,包含侧不留残影,includeChildren 跟过来', () => {
    const c = cond('and', [kw('x')], [tag('工作', true)], [tag('生活', false)]);
    const next = moveSideSelected(c, new Set(['1:0', '2:0']), 'exclude');
    // 变异自证点:同一 path 不能同时落在包含侧与排除侧
    expect(itemPaths(next, 'tag')).toEqual([]);
    expect(itemPaths(next, 'excludeTag').sort()).toEqual(['工作', '生活']);
    const g0 = uiGroups(next)[0].items.filter((it) => it.kind === 'excludeTag');
    expect(g0).toHaveLength(2);
    expect(g0[0]).toEqual({ kind: 'excludeTag', path: '工作', includeChildren: true });
    // 原位置的项已取走,但组头还在(纯函数口径)
    expect(uiGroups(next)).toHaveLength(3);
  });

  it('移回包含侧:反向同理;第 0 组已有同路径时去重(不叠两条)', () => {
    const c = cond('and', [exTag('工作', false)], [exTag('生活')]);
    const next = moveSideSelected(c, new Set(['0:0', '1:0']), 'include');
    expect(itemPaths(next, 'excludeTag')).toEqual([]);
    expect(itemPaths(next, 'tag').sort()).toEqual(['工作', '生活']);
    expect(itemsOf(next).filter((it) => it.kind === 'tag')).toHaveLength(2);
    const dup = moveSideSelected(
      cond('and', [tag('工作', true)], [exTag('工作', false)]),
      new Set(['1:0']),
      'include'
    );
    expect(dup.groups[0].items.filter((it) => it.kind === 'tag')).toHaveLength(1);
    expect(dup.groups[0].items[0]).toMatchObject({ includeChildren: true });
  });

  it('移入新组:选中项包进一个新 and 组追加末尾,组间 op 不动', () => {
    const c = cond('or', [tag('a'), tag('b'), kw('x')]);
    const next = wrapSelected(c, new Set(['0:0', '0:2']));
    expect(next.groupOp).toBe('or');
    const gs = uiGroups(next);
    expect(gs[0].items.map((it) => it.kind)).toEqual(['tag']);
    expect(gs).toHaveLength(2);
    expect(gs[1]).toEqual({ op: 'and', items: [tag('a'), kw('x')] });
  });
});

describe('四个动作的闸门', () => {
  it('非标签条件可选中但四个动作禁用,并给一句中文说明(不静默跳过)', () => {
    const c = cond('and', [kw('x'), tag('工作')]);
    const g = condGate(c, new Set(['0:0']));
    expect(g.items).toHaveLength(1);
    expect(g.canRun).toBe(false);
    expect(g.reason).toContain('非标签');
    const ok = condGate(c, new Set(['0:1']));
    expect(ok.canRun).toBe(true);
    expect(ok.reason).toBeNull();
  });

  it('选中项同时落在包含侧与排除侧时,移动方向二义 -> 不可移动并给说明', () => {
    const c = cond('and', [tag('a'), exTag('b')]);
    const mixed = condGate(c, new Set(['0:0', '0:1']));
    expect(mixed.canRun).toBe(true);
    expect(mixed.side).toBeNull();
    expect(mixed.reason).toContain('包含侧和排除侧');
    expect(condGate(c, new Set(['0:0']))).toMatchObject({ side: 'exclude', sideLabel: '移到排除侧' });
    expect(condGate(c, new Set(['0:1']))).toMatchObject({ side: 'include', sideLabel: '移回包含侧' });
  });

  it('含子级按钮文案:全是含子级时给「仅本级」,否则给「含子级」', () => {
    const c = cond('and', [tag('a', true), tag('b', false)]);
    expect(condGate(c, new Set(['0:0'])).childrenLabel).toBe('仅本级');
    expect(condGate(c, new Set(['0:1'])).childrenLabel).toBe('含子级');
    expect(condGate(c, new Set(['0:0', '0:1'])).childrenLabel).toBe('含子级');
  });

  it('空选时四个动作都不可用,且没有可显示的说明(按钮 disabled 已够显眼)', () => {
    const g = condGate(cond('and', [tag('a')]), new Set());
    expect(g).toMatchObject({ canRun: false, reason: null, side: null });
  });
});

describe('落库后读数', () => {
  it('四个动作落库后:条件项数与 chip 数一致(读数不虚高也不滞后)', () => {
    const c = cond('and', [tag('工作'), exTag('临时'), kw('x')], [tag('生活')]);
    const outs: FilterConditions[] = [
      deleteSelected(c, new Set(['0:1'])),
      setChildrenSelected(c, new Set(['0:0']), false),
      moveSideSelected(c, new Set(['0:0']), 'exclude'),
      wrapSelected(c, new Set(['0:0', '1:0'])),
    ];
    for (const out of outs) {
      const stored = JSON.parse(serializeFilterState(out)) as { groups: { items: unknown[] }[] };
      const itemCount = stored.groups.flatMap((g) => g.items).length;
      const chipCount = chipsOf(out).filter((ch) => ch.groupIndex !== undefined).length;
      expect(chipCount).toBe(itemCount);
    }
    const kept = JSON.parse(serializeFilterState(outs[0])).groups as { items: unknown[] }[];
    expect(kept.flatMap((g) => g.items)).toHaveLength(3);
  });
});
