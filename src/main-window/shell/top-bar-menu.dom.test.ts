// @vitest-environment jsdom
/**
 * Task 3(统一输入框 2/3):顶栏溢出菜单(排序 / 导出全部 / 添加条件)。
 * 覆盖 brief 的六条:点 ⋯ 出现菜单、条目顺序 = 传入顺序、checked 带勾选标记、
 * 点条目回调并关闭、Esc 关闭、点外部关闭。
 * 另钉两条同文件的接线:条目构造(标题/勾选态取自命令表)与导出反馈(菜单点完即关,
 * 「正在导出 / 已导出」必须落在菜单外的主窗上)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findCommand } from '../../shared/commands';
import { TopBar } from './TopBar';
import { ExportNotice, TopBarMenu, topBarMenuItems } from './TopBarMenu';
import type { TopBarMenuItem } from './TopBarMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let ran: string[];

/** 四条与生产同序的条目(条目构造由 topBarMenuItems 测,这里只喂形状) */
const items = (): TopBarMenuItem[] => [
  { id: 'sort.newest', label: '最新在前', checked: true, run: () => ran.push('sort.newest') },
  { id: 'sort.oldest', label: '最早在前', checked: false, run: () => ran.push('sort.oldest') },
  { id: 'export.all', label: '导出整库', danger: true, run: () => ran.push('export.all') },
  { id: 'filter.addCondition', label: '添加条件', run: () => ran.push('filter.addCondition') },
];

const render = (el: ReturnType<typeof createElement>): void => {
  act(() => root.render(el));
};
const trigger = (): HTMLElement => host.querySelector('[aria-label="更多操作"]') as HTMLElement;
const menu = (): HTMLElement | null => host.querySelector('[data-testid="topbar-menu"]');
const rows = (): HTMLElement[] => [...host.querySelectorAll('[role="menu"] > button')] as HTMLElement[];
const open = (): void => {
  render(createElement(TopBarMenu, { items: items() }));
  act(() => trigger().click());
};

beforeEach(() => {
  ran = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('顶栏溢出菜单:开关与条目', () => {
  it('初始不渲染下拉;点 ⋯ 才出现(aria-expanded 同步)', () => {
    render(createElement(TopBarMenu, { items: items() }));
    expect(menu()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    act(() => trigger().click());
    expect(menu()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('条目顺序 = 传入顺序', () => {
    open();
    expect(rows().map((r) => r.textContent)).toEqual(['最新在前', '最早在前', '导出整库', '添加条件']);
  });

  it('checked 条目带勾选标记,未 checked 的排序项不带', () => {
    open();
    const [newest, oldest] = rows();
    expect(newest.querySelector('[data-testid="topbar-menu-check"]')).not.toBeNull();
    expect(newest.getAttribute('aria-checked')).toBe('true');
    expect(oldest.querySelector('[data-testid="topbar-menu-check"]')).toBeNull();
    expect(oldest.getAttribute('aria-checked')).toBe('false');
  });
});

describe('顶栏溢出菜单:关闭手势', () => {
  it('点条目:回调被调用且菜单关闭', () => {
    open();
    act(() => rows()[1].click());
    expect(ran).toEqual(['sort.oldest']);
    expect(menu()).toBeNull();
  });

  it('Esc 关闭', () => {
    open();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it('点菜单外关闭;点菜单内不关', () => {
    open();
    act(() => {
      menu()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(menu()).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });
});

describe('条目构造:标题与勾选态取自命令表', () => {
  const built = (sort: 'newest' | 'oldest', exporting = false) =>
    topBarMenuItems({ sort, exporting, run: () => {} });

  it('顺序固定为 排序 ×2 / 导出全部 / 添加条件,标题与 danger 来自命令表', () => {
    const items = built('newest');
    expect(items.map((i) => i.id)).toEqual(['sort.newest', 'sort.oldest', 'export.all', 'filter.addCondition']);
    expect(items.map((i) => i.label)).toEqual(
      ['sort.newest', 'sort.oldest', 'export.all', 'filter.addCondition'].map((id) => findCommand(id)!.title),
    );
    expect(items.map((i) => i.danger)).toEqual([false, false, true, false]);
  });

  it('勾选态由命令自身的 toggled 求值,随 conditions.sort 翻转', () => {
    expect(built('newest').map((i) => i.checked)).toEqual([true, false, undefined, undefined]);
    expect(built('oldest').map((i) => i.checked)).toEqual([false, true, undefined, undefined]);
  });

  it('导出中:导出项文案换成「导出中…」,其余不动', () => {
    expect(built('newest', true).map((i) => i.label)).toEqual(['最新在前', '最早在前', '导出中…', '添加条件']);
  });

  it('点条目回传命令 id(执行通道仍是 commands.execute)', () => {
    const seen: string[] = [];
    const items = topBarMenuItems({ sort: 'newest', exporting: false, run: (id) => seen.push(id) });
    for (const item of items) item.run();
    expect(seen).toEqual(['sort.newest', 'sort.oldest', 'export.all', 'filter.addCondition']);
  });
});

describe('导出反馈:菜单外的顶栏提示', () => {
  it('既不在导出也没导出成功时不渲染', () => {
    render(createElement(ExportNotice, { exporting: false, exported: false }));
    expect(host.textContent).toBe('');
  });

  it('导出中给「正在导出…」,成功后给「已导出」', () => {
    render(createElement(ExportNotice, { exporting: true, exported: false }));
    expect(host.textContent).toBe('正在导出…');
    render(createElement(ExportNotice, { exporting: false, exported: true }));
    expect(host.textContent).toBe('已导出');
  });

  it('App 的 exporting/exported 经 TopBar 真透到提示上(两态都渲染得出)', () => {
    const bar = (exporting: boolean, exported: boolean) =>
      createElement(TopBar, {
        view: 'stream', sidebarVisible: true, menuItems: [], exporting, exported,
        onToggleSidebar: () => {}, onOpenSettings: () => {}, onBack: () => {},
      });
    render(bar(true, false));
    expect(host.textContent).toContain('正在导出…');
    render(bar(false, true));
    expect(host.textContent).toContain('已导出');
    render(bar(false, false));
    expect(host.textContent).not.toContain('导出');
  });
});
