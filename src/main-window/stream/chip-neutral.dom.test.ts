// @vitest-environment jsdom
/**
 * 视觉刷新 V3「chip 中性化」的组件证据(jsdom,只看类名,不引入计算样式):
 * 默认 chip = chrome 底 + 1px border + muted 文字 + radius-xs(4px),高 20-22(px-1.5 py-0.5 + text-label);
 * accent(accent-soft / accent-text)**只**出现在 hover 与选中态 —— 改前 128 个 chip 默认就是蓝字灰底;
 * 2026-10-12「引用并入关系」后**只有一排** chip(不再分主题/属性);点 chip 仍走 onTagClick(功能回归)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NoteChips } from './NoteChips';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TAGS = ['水果/苹果', '状态/想做'];

let root: Root;
let host: HTMLDivElement;
let clicked: string[];

async function render(activeTags: string[]): Promise<void> {
  await act(async () => {
    root.render(
      createElement(NoteChips, { tags: TAGS, activeTags, onTagClick: (t: string) => clicked.push(t) })
    );
  });
}

/** chip = 标签按钮(带 aria-pressed);+N 展开按钮不是标签 chip */
const chips = (): HTMLButtonElement[] =>
  [...host.querySelectorAll('button[aria-pressed]')] as HTMLButtonElement[];

/** 类名按空白切词后比对:'hover:text-accent-text' 不是 'text-accent-text' */
const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);

beforeEach(() => {
  clicked = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('V3 chip 默认态中性', () => {
  it('默认 chip = bg-chrome + border-border + text-muted + rounded-xs,且没有裸 accent 类', async () => {
    await render([]);
    expect(chips().length).toBe(2);
    for (const chip of chips()) {
      const t = tokens(chip);
      for (const token of ['rounded-xs', 'border', 'border-border', 'bg-chrome', 'text-muted', 'px-1.5', 'py-0.5', 'text-label']) {
        expect(t).toContain(token);
      }
      // accent 只能以 hover: 前缀出现(交互态),默认态计算色仍是 muted
      expect(t).not.toContain('bg-accent-soft');
      expect(t).not.toContain('text-accent-text');
      expect(t).toContain('hover:bg-accent-soft');
      expect(t).toContain('hover:text-accent-text');
      // 圆角档位唯一:chip 只允许 rounded-xs(V1 已把 --radius-xs 定为 4px)
      expect(t).not.toContain('rounded');
      expect(t).not.toContain('rounded-full');
      expect(t).not.toContain('rounded-sm');
      expect(t).not.toContain('rounded-md');
    }
  });

  it('选中 chip(在筛选里)= accent-soft 底 + accent-text 字 + aria-pressed,且不再是中性底', async () => {
    await render(['水果/苹果']);
    const active = chips().find((c) => c.getAttribute('aria-pressed') === 'true');
    expect(active).toBeTruthy();
    const t = tokens(active as Element);
    for (const token of ['bg-accent-soft', 'text-accent-text', 'border-accent', 'rounded-xs']) {
      expect(t).toContain(token);
    }
    expect(t).not.toContain('bg-chrome');
    expect(t).not.toContain('text-muted');
    // 未选中的那个仍中性:accent 只跟着"已选中"走
    const idle = chips().find((c) => c.getAttribute('aria-pressed') === 'false');
    expect(tokens(idle as Element)).toContain('bg-chrome');
  });

  it('只有一排 chip(主题/属性两排已在 2026-10-12 合并)', async () => {
    await render([]);
    const rows = [...host.querySelectorAll('div.flex-wrap')] as HTMLElement[];
    expect(rows.length).toBe(1);
    for (const row of rows) expect(row.className).toContain('gap-1');
    const [first, second] = chips();
    // 同一排里的 chip 样式逐字相同(唯一差别是标签文本)
    expect(first.className).toBe(second.className);
    expect(rows[0].contains(first)).toBe(true);
    expect(rows[0].contains(second)).toBe(true);
  });

  it('chip 仍是可点按钮:点击回调带完整标签路径', async () => {
    await render([]);
    await act(async () => chips()[0].click());
    expect(clicked).toEqual(['水果/苹果']);
  });
});
