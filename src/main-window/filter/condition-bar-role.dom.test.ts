// @vitest-environment jsdom
/**
 * Task 2 角色条件在条件栏的落笔:添加条件菜单多「角色 / 排除角色」两档,
 * 点开后列已登记角色(api.listRoles),选中即 patch 出 roles / excludeRoles。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER, type FilterConditions } from '../../shared/filter-conditions';
import { ConditionBar } from './ConditionBar';

const { carriedTagPaths, listRoles } = vi.hoisted(() => ({
  carriedTagPaths: vi.fn(),
  listRoles: vi.fn(),
}));
vi.mock('../../shared/api', () => ({ api: { carriedTagPaths, listRoles } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROLES = [
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
  listRoles.mockReset();
  listRoles.mockResolvedValue(ROLES);
  patches = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('条件栏:角色档', () => {
  it('添加条件菜单有「角色」与「排除角色」两档', async () => {
    await render();
    expect(menuItems()).toContain('角色');
    expect(menuItems()).toContain('排除角色');
  });

  it('点「角色」列出已登记角色,选中回传 roles', async () => {
    await render();
    await click([...host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find(
      (b) => b.textContent === '角色'
    ) as HTMLButtonElement);
    expect(listRoles).toHaveBeenCalled();
    expect(dialog().textContent).toContain('国籍');
    expect(dialog().textContent).toContain('所在');

    await click(buttonWith('国籍'));
    expect(patches.at(-1)?.roles).toEqual([{ path: '地点轴/国籍' }]);
  });

  it('点「排除角色」选中回传 excludeRoles', async () => {
    await render();
    await click([...host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find(
      (b) => b.textContent === '排除角色'
    ) as HTMLButtonElement);
    await click(buttonWith('所在'));
    expect(patches.at(-1)?.excludeRoles).toEqual([{ path: '地点轴/所在' }]);
  });
});
