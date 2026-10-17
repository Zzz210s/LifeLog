// @vitest-environment jsdom
/**
 * 批量会话状态的态迁移(spec 2026-10-17 §2.2/§3.3/§3.4/§9):
 * Esc 退批量(但预览卡片在场时让位)、切筛选退批量并清选中、按筛选拉全 id 只拉一次。
 */
import { useMemo } from 'react';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { Note } from '../../shared/types';
import { useBatchSelection, type BatchApi } from './use-batch-selection';

const { filterPointIds } = vi.hoisted(() => ({
  filterPointIds: vi.fn(async (_c: unknown): Promise<number[]> => [11, 12, 13]),
}));
vi.mock('../../shared/api', () => ({
  api: { filterPointIds, tagPoints: vi.fn(), untagPoints: vi.fn(), deletePoints: vi.fn() },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn(async () => true) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (id: number): Note => ({
  id,
  content: 'x',
  created_at: '2026-10-17 08:00:00',
  links: [],
  tags: [],
});

let root: Root;
let host: HTMLDivElement;
let handle: BatchApi;
let refresh: ReturnType<typeof vi.fn>;

function Harness(p: { groupOp: 'and' | 'or'; notes: Note[] }): ReactNode {
  const conditions = useMemo<FilterConditions>(
    () => ({ ...EMPTY_FILTER, groupOp: p.groupOp }),
    [p.groupOp]
  );
  handle = useBatchSelection({ conditions, notes: p.notes, refresh });
  return createElement('span', { 'data-testid': 'count' }, String(handle.selected.size));
}

const render = async (groupOp: 'and' | 'or', notes: Note[]): Promise<void> => {
  await act(async () => root.render(createElement(Harness, { groupOp, notes })));
};

/** 更新 props(切筛选用) */
const rerender = async (groupOp: 'and' | 'or', notes: Note[]): Promise<void> => {
  await act(async () => root.render(createElement(Harness, { groupOp, notes })));
};

const esc = async (): Promise<void> =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

beforeEach(() => {
  refresh = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('批量会话状态', () => {
  it('开 -> 逐条切 -> 取消,计数与两态同步', async () => {
    await render('and', [note(1), note(2)]);
    expect(handle.on).toBe(false);
    await act(async () => handle.toggleOn());
    expect(handle.on).toBe(true);
    await act(async () => handle.toggle(2));
    expect([...handle.selected]).toEqual([2]);
    await act(async () => handle.toggle(2));
    expect(handle.selected.size).toBe(0);
    await act(async () => handle.toggle(1));
    await act(async () => handle.cancel());
    expect(handle.on).toBe(false);
    expect(handle.selected.size).toBe(0);
  });

  it('全选本页是两态按钮:再点一次取消本页', async () => {
    await render('and', [note(1), note(2)]);
    await act(async () => handle.toggleOn());
    await act(async () => handle.selectPage());
    expect([...handle.selected].sort()).toEqual([1, 2]);
    expect(handle.pageAll).toBe(true);
    await act(async () => handle.selectPage());
    expect(handle.selected.size).toBe(0);
    expect(handle.pageAll).toBe(false);
  });

  it('全选筛选结果只拉一次 id,命中数与态跟着出来', async () => {
    await render('and', [note(1)]);
    await act(async () => handle.toggleOn());
    await act(async () => handle.selectAll());
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(filterPointIds).toHaveBeenCalledTimes(1);
    expect([...handle.selected].sort()).toEqual([11, 12, 13]);
    expect(handle.filterAll).toBe(true);
    expect(handle.filterTotal).toBe(3);
    // 第二次是「取消全选」,不再打 IPC
    await act(async () => handle.selectAll());
    expect(handle.selected.size).toBe(0);
    expect(filterPointIds).toHaveBeenCalledTimes(1);
  });

  it('切筛选即退出批量并清选中(§2.2)', async () => {
    await render('and', [note(1)]);
    await act(async () => handle.toggleOn());
    await act(async () => handle.toggle(1));
    await rerender('or', [note(1)]);
    expect(handle.on).toBe(false);
    expect(handle.selected.size).toBe(0);
  });

  it('Esc 退批量;预览卡片在场时让位(一次 Esc 只关卡片,§9)', async () => {
    await render('and', [note(1)]);
    await act(async () => handle.toggleOn());
    const card = document.createElement('div');
    card.setAttribute('data-testid', 'tag-preview-card');
    document.body.appendChild(card);
    await esc();
    expect(handle.on).toBe(true); // 卡片先吃这一下
    card.remove();
    await esc();
    expect(handle.on).toBe(false);
  });

  it('0 选时的动作只给回执,不发 IPC', async () => {
    await render('and', [note(1)]);
    await act(async () => handle.addTag(10, '工作'));
    expect(handle.notice).toBe('先选中条目');
    expect(refresh).not.toHaveBeenCalled();
  });
});
