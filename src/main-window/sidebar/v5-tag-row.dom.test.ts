// @vitest-environment jsdom
/**
 * 视觉刷新 V5 的侧栏行证据(设计 §4-8):
 * 行高 26(= --text-ui 的行高 18 + py-1 的 4+4)、三态(hover bg-hover / 选中 bg-selected+accent-text /
 * 排除 danger)、缩进导轨宽度(--tag-guide)、计数走 --text-label + muted(白底不达标的三级色不上文本)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagRow, guideWidth, lineIndent } from './TagRow';
import { buildTree } from './tag-tree';
import type { TagNode } from './tag-tree';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** 两棵树:书籍(1)> 书籍/SQL(2),行 fixture 直接取自 buildTree 的产物 */
const TREE: TagNode[] = buildTree([
  { id: 1, path: '书籍', depth: 1, self_count: 1, subtree_count: 2 },
  { id: 2, path: '书籍/SQL', depth: 2, self_count: 1, subtree_count: 1 },
] as never);

const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);

interface RowOver {
  selected?: boolean;
  excluded?: boolean;
  dragActive?: boolean;
  flat?: boolean;
  node?: TagNode;
  onToggle?: (n: TagNode) => void;
  onToggleExpand?: (p: string) => void;
}

function render(over: RowOver = {}): HTMLElement {
  act(() => {
    root.render(
      createElement(TagRow, {
        node: over.node ?? TREE[0],
        flat: over.flat ?? false,
        selected: over.selected ?? false,
        excluded: over.excluded ?? false,
        expanded: false,
        onToggle: over.onToggle ?? (() => {}),
        onToggleExpand: over.onToggleExpand ?? (() => {}),
        onContextMenu: () => {},
        dragSource: false,
        dropZone: null,
        dragActive: over.dragActive ?? false,
        onDragStart: () => {},
        onDragEnd: () => {},
        onDragOver: () => {},
        onDrop: () => {},
        onDragLeave: () => {},
      })
    );
  });
  return host.querySelector('button[data-tag-path]') as HTMLElement;
}

describe('V5 侧栏行:高 26(13/18 + py-1)与三态', () => {
  it('行用 --text-ui 与 py-1,不再 text-xs(行高 18 + 4 + 4 = 26)', () => {
    const row = render();
    const t = tokens(row);
    expect(t).toContain('text-ui');
    expect(t).toContain('py-1');
    expect(t).toContain('items-center');
    expect(t).not.toContain('text-xs');
    expect(t).not.toContain('py-1.5');
  });

  it('圆角取刻度(rounded-xs),行仍是可点按钮且带 data-tag-path', () => {
    const row = render();
    expect(tokens(row)).toContain('rounded-xs');
    expect(tokens(row)).not.toContain('rounded');
    expect(row.getAttribute('data-tag-path')).toBe('书籍');
  });

  it('默认态 = muted 字 + hover bg-hover/accent 前的 text;不带裸 accent', () => {
    const t = tokens(render());
    expect(t).toContain('text-muted');
    expect(t).toContain('hover:bg-hover');
    expect(t).toContain('hover:text-text');
    expect(t).not.toContain('bg-accent-soft');
    expect(t).not.toContain('text-accent-text');
    expect(t).not.toContain('hover:bg-accent-soft');
  });

  it('选中态 = bg-selected + accent-text;排除态 = danger-soft + danger;拖拽中不画 hover', () => {
    const selected = tokens(render({ selected: true }));
    expect(selected).toContain('bg-selected');
    expect(selected).toContain('text-accent-text');
    expect(selected).not.toContain('hover:bg-hover');

    const excluded = tokens(render({ excluded: true }));
    expect(excluded).toContain('bg-danger-soft');
    expect(excluded).toContain('text-danger');

    const dragging = tokens(render({ dragActive: true }));
    expect(dragging).not.toContain('hover:bg-hover');
  });

  it('计数用 --text-label + muted(白底 faint 3.69:1 不达 AA,不上文本)', () => {
    const rail = render().lastElementChild as HTMLElement;
    const t = tokens(rail);
    expect(rail.textContent).toBe('2');
    expect(t).toContain('text-label');
    expect(t).toContain('text-muted');
    expect(t).toContain('tabular-nums');
    expect(t).not.toContain('text-faint');
    expect(t).not.toContain('text-xs');
  });

  it('「已排除」角标走 text-micro + rounded-xs(11/14),不再用 text-[10px]', () => {
    const badge = render({ excluded: true }).querySelector('span.bg-danger-soft') as HTMLElement;
    expect(tokens(badge)).toContain('text-micro');
    expect(tokens(badge)).toContain('rounded-xs');
    expect(String(badge.className)).not.toContain('text-[10px]');
  });
});

describe('V5 缩进导轨:每层 1px 竖线(无额外 DOM 节点)', () => {
  it('宽度 = 最后一层线的位置 + 1px;扁平/首层不画', () => {
    expect(guideWidth(1, false)).toBe(0);
    expect(guideWidth(2, false)).toBe(1);
    expect(guideWidth(3, false)).toBe(13);
    expect(guideWidth(4, false)).toBe(25);
    expect(guideWidth(3, true)).toBe(0);
  });

  it('导轨只落在缩进区:宽度 < 行的左内边距(不压到文字)', () => {
    for (const depth of [2, 3, 4]) {
      const node = { depth } as TagNode;
      expect(guideWidth(depth, false)).toBeLessThanOrEqual(lineIndent(node, false));
    }
  });

  it('行带 tag-guides 类,并把宽度写进行内 --tag-guide;扁平模式为 0', () => {
    const row = render();
    expect(tokens(row)).toContain('tag-guides');
    expect(row.getAttribute('style')).toContain('--tag-guide: 0px'); // depth 1 不画

    const child = render({ node: TREE[0].children[0] });
    expect(child.getAttribute('style')).toContain('--tag-guide: 1px'); // depth 2 一条线
    expect(child.style.paddingLeft).toBe('18px');

    const flat = render({ flat: true });
    expect(flat.getAttribute('style')).toContain('--tag-guide: 0px');
    expect(flat.style.paddingLeft).toBe('6px');
  });
});

describe('V5 侧栏行回归:点击/展开/选中语义不变', () => {
  it('可选中行点击回调带节点;aria-pressed 跟随选中态', () => {
    const onToggle = vi.fn();
    const row = render({ onToggle });
    expect(row.getAttribute('aria-pressed')).toBe('false');
    act(() => row.click());
    expect(onToggle).toHaveBeenCalledWith(TREE[0]);
  });

  it('结构节点(子树计数 0 的补出行)点击只展开,不改选中', () => {
    const onToggle = vi.fn();
    const onToggleExpand = vi.fn();
    const structural = buildTree([{ path: 'a/b', depth: 2, self_count: 0, subtree_count: 0 }] as never)[0];
    const row = render({ node: structural, onToggle, onToggleExpand });
    expect(row.getAttribute('aria-pressed')).toBeNull();
    act(() => row.click());
    expect(onToggle).not.toHaveBeenCalled();
    expect(onToggleExpand).toHaveBeenCalledWith('a');
  });
});
