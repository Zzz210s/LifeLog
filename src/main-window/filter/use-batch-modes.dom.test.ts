// @vitest-environment jsdom
/**
 * 两个批量态互斥(方案 A §A1):条件批量与条目批量不能同时开 —— 后开的一方关掉另一方
 * (同时开会让「选中」二义:勾的到底是条目还是条件)。用例挂的就是 App 用的那份接线
 * (`useBatchModes`),判据只有一处实现。
 */
import { useMemo, useState } from 'react';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { applyFilterPatch } from './filter-state';
import { useBatchModes, type BatchModes } from './use-batch-modes';

const { filterPointIds } = vi.hoisted(() => ({ filterPointIds: vi.fn(async (): Promise<number[]> => []) }));
vi.mock('../../shared/api', () => ({
  api: { filterPointIds, tagPoints: vi.fn(), untagPoints: vi.fn(), deletePoints: vi.fn() },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn(async () => true) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let handle: BatchModes;
let patch: ReturnType<typeof vi.fn>;

function Harness(): ReactNode {
  // 条件走真补丁通道(applyFilterPatch):挪位的动作会真的换位置,选中集跟不跟得上在这里验
  const [conditions, setConditions] = useState<FilterConditions>(() => ({
    ...EMPTY_FILTER,
    groups: [{ op: 'and', items: [{ kind: 'tag', path: '工作', includeChildren: true }, { kind: 'tag', path: '生活', includeChildren: true }] }],
  }));
  const run = useMemo(
    () => ({ notes: [], refresh: () => {}, onPatch: (v: Partial<FilterConditions>) => setConditions((c) => applyFilterPatch(c, v)) }),
    []
  );
  handle = useBatchModes({ conditions, ...run, refresh: run.refresh });
  return createElement('span', { 'data-testid': 'flags' }, `${handle.notes.on}/${handle.conds.on}`);
}

beforeEach(() => {
  patch = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

const mount = async (): Promise<void> => {
  await act(async () => root.render(createElement(Harness)));
};
const flags = (): string => `${handle.notes.on}/${handle.conds.on}`;

describe('两个批量态互斥', () => {
  it('先开条件批量,再开条目批量 -> 条件批量被关掉', async () => {
    await mount();
    expect(flags()).toBe('false/false');
    await act(async () => handle.conds.toggleOn());
    expect(flags()).toBe('false/true');
    await act(async () => handle.notes.toggleOn());
    expect(flags()).toBe('true/false');
  });

  it('先开条目批量,再开条件批量 -> 条目批量被关掉(反向同理)', async () => {
    await mount();
    await act(async () => handle.notes.toggleOn());
    expect(flags()).toBe('true/false');
    await act(async () => handle.conds.toggleOn());
    expect(flags()).toBe('false/true');
  });

  it('关掉自己不吃掉另一方:再点同一颗开关只关自己', async () => {
    await mount();
    await act(async () => handle.conds.toggleOn());
    await act(async () => handle.conds.toggleOn());
    expect(flags()).toBe('false/false');
    await act(async () => handle.notes.toggleOn());
    await act(async () => handle.notes.toggleOn());
    expect(flags()).toBe('false/false');
  });

  it('另一方的选中集也一起清掉(不是只把 on 置假)', async () => {
    await mount();
    await act(async () => handle.conds.toggle('0:0'));
    await act(async () => handle.conds.toggleOn());
    await act(async () => handle.notes.toggleOn());
    expect(handle.conds.on).toBe(false);
    expect(handle.conds.selected.size).toBe(0);
  });

  it('挪位的动作之后选中集跟着项走:移到排除侧 -> 接着移入新组,不必重新勾选', async () => {
    await mount();
    await act(async () => handle.conds.toggleOn());
    await act(async () => handle.conds.selectAll());
    expect(handle.conds.count).toBe(2);
    await act(async () => handle.conds.moveSide());
    expect(handle.conds.selected.size).toBe(2);
    expect(handle.conds.count).toBe(2);
    expect(handle.conds.gate.side).toBe('include'); // 两项都已到排除侧 -> 按钮变「移回包含侧」
    await act(async () => handle.conds.wrapNewGroup());
    expect(handle.conds.selected.size).toBe(2);
    expect(handle.conds.gate.items.every((s) => s.item.kind === 'excludeTag')).toBe(true);
  });

  it('删除清选中(删掉的项已不存在,不能留下虚高的读数)', async () => {
    await mount();
    await act(async () => handle.conds.toggleOn());
    await act(async () => handle.conds.selectAll());
    await act(async () => handle.conds.removeSelected());
    expect(handle.conds.selected.size).toBe(0);
    expect(handle.conds.count).toBe(0);
  });

  it('含子级切换不挪位:选中集原样保留(可以接着再切回来)', async () => {
    await mount();
    await act(async () => handle.conds.toggleOn());
    await act(async () => handle.conds.selectAll());
    await act(async () => handle.conds.setChildren(false));
    expect(handle.conds.selected.size).toBe(2);
    expect(handle.conds.gate.items.every((s) => (s.item as { includeChildren: boolean }).includeChildren === false)).toBe(true);
    await act(async () => handle.conds.setChildren(true));
    expect(handle.conds.gate.childrenLabel).toBe('仅本级');
  });
});
