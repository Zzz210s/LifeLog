// @vitest-environment jsdom
/**
 * 条件栏:条件 chips + 中文摘要 + 两个就近鼠标入口(排序 / 添加条件)。
 * 2026-10-07 盘点:排序与添加条件从顶栏 `⋯` 移回本栏(与 `>` 命令同一通道);
 * 摘要与受控菜单在 `condition-bar-menu.dom.test.ts`(拆分守 200 行红线)。
 * chips 口径沿用旧 filter-bar-style.dom.test.ts 里仍然有效的回归项。
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { itemPaths } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { buttonTextOf, FULL_BAR_COND, mountConditionBar, type MountedBar, tokensOf } from './__fixtures__/condition-bar-harness';

// 携带集合走 IPC:本文件固定返回空集(携带专项见 condition-bar-carry.dom.test.ts)
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

describe('条件栏:chips + 两个就近入口', () => {
  it('带排序图标按钮与「添加条件」按钮;其余按钮只能是 chip 的单删 / 编辑', async () => {
    await m.render(FULL_BAR_COND);
    const buttons = m.buttons();
    expect(buttons.length).toBeGreaterThan(0); // 断言不是"整栏没按钮"这种假绿
    expect(m.host().querySelector('button[aria-label="排序"]')).not.toBeNull();
    expect(m.host().querySelector('button[aria-label="添加条件"]')).not.toBeNull();
    // 剩下的按钮只能是 chip 自己的单删 × 与表达式编辑入口(条件组工具条的组头按钮另算)
    const chipButtons = buttons
      .filter((b) => b.closest('[data-testid="filter-group-bar"]') === null)
      .filter((b) => !['排序', '添加条件'].includes(b.getAttribute('aria-label') ?? ''));
    for (const b of chipButtons) {
      expect(buttonTextOf(b)).toMatch(/移除条件|编辑条件/);
    }
  });

  it('外层仍是条件栏样式(border-b + px-4 + py-1),故以 data-testid 锚定', async () => {
    await m.render();
    const t = tokensOf(m.bar());
    for (const token of ['border-b', 'border-border', 'px-4', 'py-1']) expect(t).toContain(token);
    expect(m.bar().getAttribute('data-testid')).toBe('condition-bar');
  });
});

describe('条件栏:条件 chips 的显示与单删', () => {
  it('关键词 chip 可单删:点 × 回传 keyword: null,其余条件原样带出', async () => {
    await m.render(FULL_BAR_COND);
    const removeBtn = m.chips()[0].querySelector('button') as HTMLButtonElement;
    expect(removeBtn.getAttribute('aria-label')).toBe('移除条件 关键词:电影');
    act(() => removeBtn.click());
    const patches = m.patches();
    expect(patches.length).toBe(1);
    expect(patches[0].keyword).toBeNull();
    expect(itemPaths(patches[0] as FilterConditions, 'tag')).toEqual(['工作']);
    expect(itemPaths(patches[0] as FilterConditions, 'excludeTag')).toEqual(['临时']);
  });

  it('tags / excludeTags 各自一个 chip,标签文案即路径', async () => {
    await m.render(FULL_BAR_COND);
    const labels = m.chips().map((c) => c.textContent ?? '');
    expect(m.chips().length).toBe(6);
    expect(labels[1]).toContain('工作');
    expect(labels[2]).toContain('临时');
    expect(m.patches()).toEqual([]);
  });

  it('回归:六种 chip 都是 rounded-xs + text-label + 1px border,gap-1(4px)', async () => {
    await m.render(FULL_BAR_COND);
    const list = m.chips();
    expect(tokensOf(list[0].parentElement as HTMLElement)).toContain('gap-1');
    for (const chip of list) {
      const t = tokensOf(chip);
      for (const token of ['rounded-xs', 'border', 'text-label', 'px-2', 'py-0.5']) expect(t).toContain(token);
      expect(t).not.toContain('rounded-full');
    }
  });

  it('回归:中性条件(有无标签 / 排序)= chrome 底 + muted 字;收窄条件 = accent', async () => {
    await m.render(FULL_BAR_COND);
    const [keyword, tag, , presence, expr, sort] = m.chips();
    for (const neutral of [presence, sort]) {
      const t = tokensOf(neutral);
      expect(t).toContain('bg-chrome');
      expect(t).toContain('text-muted');
      expect(t).not.toContain('bg-accent-soft');
    }
    for (const picked of [keyword, tag, expr]) {
      const t = tokensOf(picked);
      expect(t).toContain('bg-accent-soft');
      expect(t).toContain('text-accent-text');
    }
  });

  it('回归:排除标签 chip 仍走 danger 语义色;表达式 chip 的 label 可点(编辑入口)', async () => {
    await m.render(FULL_BAR_COND);
    const exclude = tokensOf(m.chips()[2]);
    expect(exclude).toContain('text-danger');
    expect(exclude).toContain('bg-danger-soft');
    expect(m.chips()[4].querySelector('button[aria-label^="编辑条件"]')).toBeTruthy();
    expect(m.chips()[0].querySelector('button[aria-label^="编辑条件"]')).toBeNull();
  });
});
