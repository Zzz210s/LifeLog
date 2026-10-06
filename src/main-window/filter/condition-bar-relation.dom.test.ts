// @vitest-environment jsdom
/**
 * 关系条件在条件栏的落笔(设计 2026-10-06 §10 R10b):
 * 添加条件菜单是「关系 / 排除关系」两档,点开后列全部可被指向的标签(api.listTypes),
 * 选中即 patch 出 relations / excludeRelations。
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

describe('条件栏:关系档', () => {
  it('添加条件菜单有「关系」与「排除关系」两档', async () => {
    await render();
    expect(menuItems()).toContain('关系');
    expect(menuItems()).toContain('排除关系');
  });

  it('点「关系」列出全部可被指向的标签,选中回传 relations', async () => {
    await render();
    await click([...host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find(
      (b) => b.textContent === '关系'
    ) as HTMLButtonElement);
    expect(listTypes).toHaveBeenCalled();
    expect(dialog().textContent).toContain('国籍');
    expect(dialog().textContent).toContain('所在');

    await click(buttonWith('国籍'));
    expect(patches.at(-1)?.relations).toEqual([{ path: '地点轴/国籍' }]);
  });

  it('点「排除关系」选中回传 excludeRelations', async () => {
    await render();
    await click([...host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find(
      (b) => b.textContent === '排除关系'
    ) as HTMLButtonElement);
    await click(buttonWith('所在'));
    expect(patches.at(-1)?.excludeRelations).toEqual([{ path: '地点轴/所在' }]);
  });
});
