// @vitest-environment jsdom
/**
 * Task 2 类型条件在条件栏的落笔:添加条件菜单多「类型 / 排除类型」两档,
 * 点开后列已登记类型(api.listTypes),选中即 patch 出 types / excludeTypes。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER, type FilterConditions } from '../../shared/filter-conditions';
import { ConditionBar } from './ConditionBar';

const { carriedTagPaths, listTypes } = vi.hoisted(() => ({
  carriedTagPaths: vi.fn(),
  listTypes: vi.fn(),
}));
vi.mock('../../shared/api', () => ({ api: { carriedTagPaths, listTypes } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TYPES = [
  { tagId: 7, path: '地点轴/国籍', name: '国籍' },
  { tagId: 8, path: '地点轴/所在', name: '所在' },
];

let root: Root;
let host: HTMLDivElement;
let patches: Array<Partial<FilterConditions>>;

async function render(addConditionOpen = true): Promise<void> {
  await act(async () => {
    root.render(
      createElement(ConditionBar, {
        conditions: EMPTY_FILTER,
        onPatch: (v: Partial<FilterConditions>) => patches.push(v),
        addConditionOpen,
        onAddConditionOpenChange: () => {},
      })
    );
  });
}

const menuItems = (): string[] =>
  [...host.querySelectorAll('button[role="menuitem"]')].map((b) => b.textContent ?? '');
const dialog = (): HTMLElement => host.querySelector('[role="dialog"]') as HTMLElement;
const buttonWith = (text: string): HTMLButtonElement =>
  [...dialog().querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text)) as HTMLButtonElement;

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
  });
}

beforeEach(() => {
  carriedTagPaths.mockReset();
  carriedTagPaths.mockResolvedValue([]);
  listTypes.mockReset();
  listTypes.mockResolvedValue(TYPES);
  patches = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('条件栏:类型档', () => {
  it('添加条件菜单有「类型」与「排除类型」两档', async () => {
    await render();
    expect(menuItems()).toContain('类型');
    expect(menuItems()).toContain('排除类型');
  });

  it('点「类型」列出已登记类型,选中回传 types', async () => {
    await render();
    await click([...host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find(
      (b) => b.textContent === '类型'
    ) as HTMLButtonElement);
    expect(listTypes).toHaveBeenCalled();
    expect(dialog().textContent).toContain('国籍');
    expect(dialog().textContent).toContain('所在');

    await click(buttonWith('国籍'));
    expect(patches.at(-1)?.types).toEqual([{ path: '地点轴/国籍' }]);
  });

  it('点「排除类型」选中回传 excludeTypes', async () => {
    await render();
    await click([...host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find(
      (b) => b.textContent === '排除类型'
    ) as HTMLButtonElement);
    await click(buttonWith('所在'));
    expect(patches.at(-1)?.excludeTypes).toEqual([{ path: '地点轴/所在' }]);
  });
});
