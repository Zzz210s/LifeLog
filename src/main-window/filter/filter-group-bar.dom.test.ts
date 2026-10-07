// @vitest-environment jsdom
/**
 * 条件组界面(T3):条件栏组头能切组内 且/或、能删组/加组;OR 组的组头显示「组命中 N 条」
 * (chip 上不给单条读数);「添加条件」的「条件组」子面板能选条件落进第几组。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER, normalizeGroups } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { ConditionHits } from '../../shared/tag-facts-types';
import { AddConditionMenu } from './AddConditionMenu';
import { FilterGroupBar } from './FilterGroupBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tag = (path: string) => ({ kind: 'tag' as const, path, includeChildren: true });

const twoGroups = (): FilterConditions =>
  normalizeGroups({
    ...EMPTY_FILTER,
    groups: [
      { op: 'and', items: [tag('地点轴/所在')] },
      { op: 'or', items: [tag('地点轴/产地'), tag('状态/未完成')] },
    ],
  });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const buttonByLabel = (label: string): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) as HTMLButtonElement;

describe('条件组工具条', () => {
  it('每组一个组头;OR 组显示「组命中 N 条」,AND 组不给组读数', () => {
    const hits: ConditionHits = {
      groups: [
        { op: 'and', itemHits: [3], groupHit: null },
        { op: 'or', itemHits: [], groupHit: 7 },
      ],
    };
    act(() =>
      root.render(createElement(FilterGroupBar, { conditions: twoGroups(), onPatch: () => {}, hits }))
    );
    expect(host.querySelector('[data-testid="filter-group-0"]')?.textContent).toContain('组 1');
    expect(host.querySelector('[data-testid="filter-group-1"]')?.textContent).toContain('组命中 7 条');
    expect(host.querySelector('[data-testid="filter-group-0"]')?.textContent).not.toContain('组命中');
  });

  it('点组内 且/或 切换:回传的条件对象里该组 op 翻转,其余组不动', () => {
    const patches: Array<Partial<FilterConditions>> = [];
    act(() =>
      root.render(
        createElement(FilterGroupBar, {
          conditions: twoGroups(),
          onPatch: (v) => patches.push(v),
          hits: null,
        })
      )
    );
    act(() => buttonByLabel('切换第 2 组组内关系').click());
    const next = patches.at(-1) as FilterConditions;
    expect(next.groups[1].op).toBe('and');
    expect(next.groups[0].op).toBe('and');
  });

  it('组间 且/或 切换改的是 groupOp', () => {
    const patches: Array<Partial<FilterConditions>> = [];
    act(() =>
      root.render(
        createElement(FilterGroupBar, {
          conditions: twoGroups(),
          onPatch: (v) => patches.push(v),
          hits: null,
        })
      )
    );
    act(() => buttonByLabel('切换组间关系').click());
    expect((patches.at(-1) as FilterConditions).groupOp).toBe('or');
  });

  it('加一组/删一组:组数随之增减(空组也留组头,可继续往里加)', () => {
    let cur = twoGroups();
    const render = () =>
      act(() =>
        root.render(
          createElement(FilterGroupBar, {
            conditions: cur,
            onPatch: (v) => {
              cur = v as FilterConditions;
              render();
            },
            hits: null,
          })
        )
      );
    render();
    act(() => buttonByLabel('在第 1 组后再加一组').click());
    expect(cur.groups).toHaveLength(3);
    expect(cur.groups[2].items).toHaveLength(0);
    act(() => buttonByLabel('删除第 3 组').click());
    expect(cur.groups).toHaveLength(2);
  });
});

describe('添加条件:「条件组」子面板', () => {
  it('列出各组与新建组;选第 2 组后点「标签」回传 group=1', () => {
    const onPickTag = vi.fn();
    act(() =>
      root.render(
        createElement(AddConditionMenu, {
          conditions: twoGroups(),
          onPatch: () => {},
          onPickTag,
          onPickRelation: () => {},
          onOpenExpr: () => {},
          open: true,
          onOpenChange: () => {},
          showTrigger: false,
        })
      )
    );
    const items = (): string[] =>
      [...host.querySelectorAll('button[role="menuitem"]')].map((b) => b.textContent ?? '');
    act(() => [...host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find((b) => b.textContent === '条件组')!.click());
    expect(items()).toEqual([
      '第 1 组（组内且，1 项）',
      '第 2 组（组内或，2 项）',
      '新建一组（下一个条件进新组）',
    ]);
    act(() => [...host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find((b) => b.textContent === '第 2 组（组内或，2 项）')!.click());
    act(() => [...host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find((b) => b.textContent === '标签')!.click());
    expect(onPickTag).toHaveBeenCalledWith(false, 1);
  });
});
