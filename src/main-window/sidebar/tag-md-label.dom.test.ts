// @vitest-environment jsdom
/**
 * 标签名行内 md(T1)在侧栏与标签菜单的接线证据:显示位是**预览态**(`[郴](chēn)州市` -> 郴州市,
 * 悬浮 data-tip=chēn),而 data 属性 / 回调 / 确认文案里的路径都是**去掉语法后的纯文本**(或原始路径)。
 */
import { act, createElement } from 'react';

/** 让元素看起来"被 CSS 截断"(jsdom 里 scrollWidth/clientWidth 恒 0):随后触发 React 的 onMouseEnter */
function markTruncated(el: HTMLElement): void {
  Object.defineProperty(el, 'scrollWidth', { value: 999, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
}

/** 未截断时不挂 title;截断后悬浮才给完整文本 */
function expectHoverTitle(el: HTMLElement, text: string): void {
  expect(el.getAttribute('title')).toBeNull();
  markTruncated(el);
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  expect(el.getAttribute('title')).toBe(text);
}

import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagRow } from './TagRow';
import { TagMenuDeletePane } from './TagMenuDeletePane';
import { TagMenuMainPane } from './TagMenuMainPane';
import { buildTree } from './tag-tree';
import type { TagNode } from './tag-tree';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 原始路径(带 md 语法)与它去掉语法后的可见文本 */
const RAW = '地点/[郴](chēn)州市';
const PLAIN = '地点/郴州市';

const NODE: TagNode = buildTree([
  { id: 1, path: RAW, depth: 2, self_count: 1, subtree_count: 1 },
] as never)[0].children[0];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(el: ReturnType<typeof createElement>): void {
  act(() => root.render(el));
}

function renderRow(flat: boolean, onToggle = (): void => undefined): HTMLElement {
  mount(
    createElement(TagRow, {
      node: NODE,
      flat,
      selected: false,
      excluded: false,
      expanded: false,
      onToggle,
      onToggleExpand: () => {},
      onContextMenu: () => {},
      dragSource: false,
      dropZone: null,
      dragActive: false,
      onDragStart: () => {},
      onDragEnd: () => {},
      onDragOver: () => {},
      onDrop: () => {},
      onDragLeave: () => {},
    })
  );
  return host.querySelector('button[data-tag-path]') as HTMLElement;
}

describe('T1 侧栏树行:预览态 + 原始路径寻址', () => {
  it('树模式显示末级预览文本,data-tag-path 与点击回传仍是原始路径', () => {
    const onToggle = vi.fn();
    const row = renderRow(false, onToggle);
    const label = row.querySelector('span.truncate') as HTMLElement;
    expect(label.textContent).toBe('郴州市');
    expect(row.getAttribute('data-tag-path')).toBe(RAW);
    expect(row.getAttribute('data-tip')).toBeNull();
    expect(row.querySelector('span[data-tip="chēn"]')?.textContent).toBe('郴');
    expect(row.querySelector('a')).toBeNull();
    act(() => row.click());
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ path: RAW }));
  });

  it('扁平模式显示完整路径的预览文本', () => {
    expect((renderRow(true).querySelector('span.truncate') as HTMLElement).textContent).toBe(PLAIN);
  });
});

describe('T1 标签菜单:标题渲染态,确认文案纯文本', () => {
  it('主面板标题显示预览文本(悬浮仍是纯文本全路径)', () => {
    mount(createElement(TagMenuMainPane, { path: RAW, onPick: () => {} }));
    const title = host.querySelector('p') as HTMLElement;
    expect(title.textContent).toBe(PLAIN);
    expectHoverTitle(title, PLAIN);
    expect(host.querySelector('a')).toBeNull();
  });

  it('删除确认文案用纯文本,不把语法原样摆给用户', () => {
    mount(
      createElement(TagMenuDeletePane, {
        path: RAW,
        impact: { tags: 0, notes: 1, carriers: 0 },
        error: '',
        busy: false,
        onCancel: () => {},
        onConfirm: () => {},
      })
    );
    const first = host.querySelector('p') as HTMLElement;
    expect(first.textContent).toBe(`删除「${PLAIN}」?`);
    expect(host.textContent).not.toContain('[郴]');
  });

  it('删除确认显示被携带数(R5:删被携带的标签会一并清掉携带行)', () => {
    mount(
      createElement(TagMenuDeletePane, {
        path: PLAIN,
        impact: { tags: 0, notes: 1, carriers: 2 },
        error: '',
        busy: false,
        onCancel: () => {},
        onConfirm: () => {},
      })
    );
    expect(host.textContent).toContain('该标签被 2 个标签指向');
  });
});
