// @vitest-environment jsdom
/**
 * 排序面板(T2):列表(勾选框 + 维度/轴名 + 方向 + 上移/下移 + 移除)+ 添加行 + 上限 5。
 * 写库只走 `sorts`(onPatch({ sorts })),不再带旧 `sort` —— 这是 T2 的口径(设计 §4.7)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER, MAX_SORT_CONDS } from '../../shared/filter-conditions';
import type { FilterConditions, SortCond } from '../../shared/filter-conditions';
import { SortPanel } from './SortPanel';

const { listTags } = vi.hoisted(() => ({ listTags: vi.fn() }));
vi.mock('../../shared/api', () => ({ api: { listTags } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TIME_DESC: SortCond = { kind: 'time', dir: 'desc', enabled: true };
const PLACE_ASC: SortCond = { kind: 'tag', path: '地点', dir: 'asc', enabled: true };
const STATE_ASC: SortCond = { kind: 'tag', path: '状态', dir: 'asc', enabled: true };

let root: Root;
let host: HTMLDivElement;
let patched: Array<Partial<FilterConditions>>;

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

async function render(sorts: SortCond[]): Promise<void> {
  await act(async () => {
    root.render(
      createElement(SortPanel, {
        conditions: { ...EMPTY_FILTER, sorts, sort: sorts.some((s) => s.kind === 'time' && s.enabled && s.dir === 'asc') ? 'oldest' : 'newest' },
        onPatch: (v: Partial<FilterConditions>) => patched.push(v),
      })
    );
  });
}

const rows = (): HTMLElement[] => [...host.querySelectorAll('[data-testid="sort-row"]')] as HTMLElement[];
const rowButtons = (row: HTMLElement): HTMLButtonElement[] => [...row.querySelectorAll('button')] as HTMLButtonElement[];
const byLabel = (label: string): HTMLButtonElement | null =>
  host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const checkbox = (label: string): HTMLInputElement =>
  host.querySelector(`input[type="checkbox"][aria-label="${label}"]`) as HTMLInputElement;

beforeEach(() => {
  listTags.mockReset();
  listTags.mockResolvedValue([
    { id: 1, path: '地点', depth: 0, self_count: 1, subtree_count: 2 },
    { id: 2, path: '状态', depth: 0, self_count: 1, subtree_count: 1 },
  ]);
  patched = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const lastSorts = (): SortCond[] => {
  const last = patched[patched.length - 1];
  expect(last.sorts).toBeDefined();
  expect(last.sort).toBeUndefined(); // 写库只走 sorts
  return last.sorts as SortCond[];
};

describe('排序面板:列表渲染', () => {
  it('每条一行:勾选框 + 轴名 + 方向 + 上移/下移/移除', async () => {
    await render([TIME_DESC, PLACE_ASC]);
    expect(rows()).toHaveLength(2);
    expect(checkbox('启用 时间').checked).toBe(true);
    expect(checkbox('启用 地点').checked).toBe(true);
    expect(host.textContent).toContain('时间');
    expect(host.textContent).toContain('地点');
    for (const row of rows()) {
      expect(rowButtons(row).map((b) => b.getAttribute('aria-label'))).toEqual([
        `上移 ${row.textContent?.includes('时间') === true ? '时间' : '地点'}`,
        `下移 ${row.textContent?.includes('时间') === true ? '时间' : '地点'}`,
        `移除排序 ${row.textContent?.includes('时间') === true ? '时间' : '地点'}`,
      ]);
    }
  });

  it('空列表给出默认提示(时间 新 -> 旧),不渲染行', async () => {
    await render([]);
    expect(rows()).toHaveLength(0);
    expect(host.textContent).toContain('默认');
    expect(host.textContent).toContain('新 -> 旧');
  });

  it('键盘可达:上移/下移/移除都是可聚焦 button(无 tabindex=-1)', async () => {
    await render([TIME_DESC, PLACE_ASC]);
    const move = [byLabel('上移 时间'), byLabel('下移 时间'), byLabel('上移 地点'), byLabel('下移 地点')];
    for (const b of move) {
      expect(b).not.toBeNull();
      expect(b!.tagName).toBe('BUTTON');
      expect(b!.getAttribute('tabindex')).toBeNull();
    }
  });
});

describe('排序面板:逐条编辑', () => {
  it('勾掉第一条 = enabled:false(写回整份 sorts)', async () => {
    await render([TIME_DESC, PLACE_ASC]);
    act(() => checkbox('启用 时间').click());
    expect(lastSorts()).toEqual([{ ...TIME_DESC, enabled: false }, PLACE_ASC]);
  });

  it('方向选项文案随维度变:时间两条 / 标签两条不同', async () => {
    await render([TIME_DESC, PLACE_ASC]);
    const options = (label: string): string[] =>
      [...(host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement).options].map((o) => o.textContent ?? '');
    expect(options('方向 时间')).toEqual(['新 -> 旧', '旧 -> 新']);
    expect(options('方向 地点')).toEqual(['选项顺序', '选项倒序']);
  });

  it('改方向写回该条 dir', async () => {
    await render([PLACE_ASC]);
    const select = host.querySelector('select[aria-label="方向 地点"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'desc';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(lastSorts()).toEqual([{ ...PLACE_ASC, dir: 'desc' }]);
  });

  it('下移改优先级,首条上移 / 末条下移禁用', async () => {
    await render([TIME_DESC, PLACE_ASC]);
    expect(byLabel('上移 时间')!.disabled).toBe(true);
    expect(byLabel('下移 地点')!.disabled).toBe(true);
    act(() => byLabel('下移 时间')!.click());
    expect(lastSorts()).toEqual([PLACE_ASC, TIME_DESC]);
  });

  it('移除只删该条', async () => {
    await render([TIME_DESC, PLACE_ASC, STATE_ASC]);
    act(() => byLabel('移除排序 地点')!.click());
    expect(lastSorts()).toEqual([TIME_DESC, STATE_ASC]);
  });
});

describe('排序面板:添加与上限', () => {
  it('点「+ 排序条件」选「时间」追加一条时间降序', async () => {
    await render([PLACE_ASC]);
    act(() => (host.querySelector('[data-testid="sort-add"]') as HTMLButtonElement).click());
    act(() => (host.querySelector('[data-testid="sort-add-time"]') as HTMLButtonElement).click());
    expect(lastSorts()).toEqual([PLACE_ASC, TIME_DESC]);
  });

  it('已有时间条件时「时间」不可再加(去重)', async () => {
    await render([TIME_DESC]);
    act(() => (host.querySelector('[data-testid="sort-add"]') as HTMLButtonElement).click());
    const timeBtn = host.querySelector('[data-testid="sort-add-time"]') as HTMLButtonElement;
    expect(timeBtn.disabled).toBe(true);
  });

  it(`到 ${MAX_SORT_CONDS} 条:添加入口禁用并给中文提示`, async () => {
    const five: SortCond[] = [
      TIME_DESC,
      PLACE_ASC,
      STATE_ASC,
      { kind: 'tag', path: '作者', dir: 'asc', enabled: true },
      { kind: 'tag', path: '标签', dir: 'asc', enabled: true },
    ];
    await render(five);
    const add = host.querySelector('[data-testid="sort-add"]') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute('title')).toBe(`排序条件最多 ${MAX_SORT_CONDS} 条`);
    expect((host.querySelector('[data-testid="sort-cap-hint"]') as HTMLElement).textContent).toContain(
      `排序条件最多 ${MAX_SORT_CONDS} 条`
    );
    act(() => add.click());
    expect(patched).toEqual([]);
  });

  it('选「标签轴」打开标签选择器,选中即追加(方向默认 选项顺序)', async () => {
    await render([TIME_DESC]);
    act(() => (host.querySelector('[data-testid="sort-add"]') as HTMLButtonElement).click());
    await act(async () => {
      (host.querySelector('[data-testid="sort-add-tag"]') as HTMLButtonElement).click();
    });
    await flush();
    const rowsInDialog = [...host.querySelectorAll('[role="dialog"] button')] as HTMLButtonElement[];
    const place = rowsInDialog.find((b) => (b.textContent ?? '').includes('地点'))!;
    act(() => place.click());
    expect(lastSorts()).toEqual([TIME_DESC, PLACE_ASC]);
  });
});
