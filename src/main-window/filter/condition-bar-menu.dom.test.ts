// @vitest-environment jsdom
/**
 * 条件栏另一半:中文摘要 + 受控的添加条件菜单(自 condition-bar.dom.test.ts 拆出守 200 行)。
 * 菜单开关由命令 / 顶栏溢出菜单驾驶,浮层仍挂在本栏(锚点不变),组件自身不自持状态。
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FULL_BAR_COND, mountConditionBar, type MountedBar, tokensOf } from './__fixtures__/condition-bar-harness';
import { summaryOf, summaryTitleOf } from './filter-chips';

const { carriedTagPaths, conditionHitCounts } = vi.hoisted(() => ({ carriedTagPaths: vi.fn(), conditionHitCounts: vi.fn() }));
vi.mock('../../shared/api', () => ({ api: { carriedTagPaths, conditionHitCounts } }));

let m: MountedBar;

beforeEach(() => {
  carriedTagPaths.mockReset();
  carriedTagPaths.mockResolvedValue([]);
  conditionHitCounts.mockResolvedValue({ groups: [{ op: 'and', itemHits: [], groupHit: null }] });
  m = mountConditionBar();
});

afterEach(() => {
  m.unmount();
});

const menuItems = (menu: HTMLElement): string[] =>
  [...menu.querySelectorAll('button[role="menuitem"]')].map((b) => b.textContent ?? '');

describe('条件栏:中文摘要', () => {
  it('渲染中文摘要且带 title(悬浮看未截断的表达式原文)', async () => {
    await m.render(FULL_BAR_COND);
    const summary = m.host().querySelector('[data-testid="condition-bar-summary"]') as HTMLElement;
    expect(summary.textContent).toBe(summaryOf(FULL_BAR_COND, new Set()));
    expect(summary.getAttribute('title')).toBe(summaryTitleOf(FULL_BAR_COND, new Set()));
    expect(tokensOf(summary)).toContain('text-label');
    expect(tokensOf(summary)).toContain('text-muted');
  });

  it('空条件不渲染摘要', async () => {
    await m.render();
    expect(m.host().querySelector('[data-testid="condition-bar-summary"]')).toBeNull();
  });
});

describe('条件栏:添加条件菜单受控', () => {
  it('addConditionOpen=true 时菜单出现,项在;false 时不渲染菜单', async () => {
    await m.render(FULL_BAR_COND);
    expect(m.menu()).toBeNull();
    await m.render(FULL_BAR_COND, true);
    expect(m.menu()).not.toBeNull();
    expect(menuItems(m.menu() as HTMLElement)).toEqual([
      '标签',
      '排除标签',
      '关系',
      '排除关系',
      '有无标签',
      '条件组',
      '排序',
      '分组',
      '表达式(高级)',
    ]);
  });

  it('分组子面板:点「分组」渲染分组面板(默认不分组,不改筛选条件)', async () => {
    await m.render(FULL_BAR_COND, true);
    const btn = [...(m.menu() as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find(
      (b) => b.textContent === '分组'
    ) as HTMLButtonElement;
    act(() => btn.click());
    const panel = m.host().querySelector('[data-testid="group-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('默认:不分组');
  });

  it('有无标签子面板:文案是「无标签」,不再叫「无自定义标签」', async () => {
    await m.render(FULL_BAR_COND, true);
    const pane = [...(m.menu() as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find(
      (b) => b.textContent === '有无标签'
    ) as HTMLButtonElement;
    act(() => pane.click());
    expect(menuItems(m.menu() as HTMLElement)).toEqual(['不限', '有标签', '无标签']);
  });

  it('菜单自身只通过 onAddConditionOpenChange 关闭(受控,不自持状态)', async () => {
    await m.render(FULL_BAR_COND, true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(m.opens()).toEqual([false]);
    expect(m.menu()).not.toBeNull(); // 父级还没把 open 置假,浮层就还在
  });
});
