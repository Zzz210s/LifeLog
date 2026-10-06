// @vitest-environment jsdom
/**
 * 标签行单测共用夹具(仅测试引用):一行 `TagRow` 与**真实** `HoverTip` 一起挂,
 * 于是「悬停 → data-tip 气泡」这条链路在单测里也是真的(不是只读属性值)。
 * jsdom 里 scrollWidth/clientWidth 恒 0,`markTruncated` 手动造出「被 CSS 截断」的读数。
 */
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HoverTip } from '../../shell/HoverTip';
import { TagRow } from '../TagRow';
import type { TagNode } from '../tag-tree';
import type { RelationRef } from '../../../shared/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const rel = (toTagId: number, name: string, remark = ''): RelationRef => ({
  toTagId,
  path: name,
  name,
  remark,
});

/** 叶子标签(直接给 TagNode:buildTree 会把缺的祖先补成结构节点,拿不到这一行) */
export const LEAF: TagNode = {
  id: 1,
  path: '作者/冯骥才',
  name: '冯骥才',
  depth: 2,
  sortOrder: 0,
  selfCount: 1,
  subtreeCount: 1,
  children: [],
};

export interface RowOver {
  relations?: readonly RelationRef[];
  showRelations?: boolean;
}

export interface RowHarness {
  host: HTMLDivElement;
  /** 渲染并返回行元素(查询口径与既有用例一致) */
  render: (over?: RowOver) => HTMLElement;
  unmount: () => void;
  /** 行上的标签名 span */
  name: (row: HTMLElement) => HTMLElement;
  /** 行内关系小字 */
  chips: () => HTMLElement[];
  /** 瞬时气泡(HoverTip 渲染,悬停后才有) */
  bubble: () => HTMLElement | null;
}

export function mountTagRow(): RowHarness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);

  const render = (over: RowOver = {}): HTMLElement => {
    act(() => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(TagRow, {
            node: LEAF,
            flat: false,
            selected: false,
            excluded: false,
            expanded: false,
            onToggle: () => {},
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
            relations: over.relations ?? [],
            showRelations: over.showRelations ?? false,
          }),
          createElement(HoverTip)
        )
      );
    });
    return host.querySelector('button[data-tag-path]') as HTMLElement;
  };

  return {
    host,
    render,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
    name: (row) => [...row.querySelectorAll('span')].find((s) => s.textContent === '冯骥才') as HTMLElement,
    chips: () => [...host.querySelectorAll<HTMLElement>('[data-tag-relation]')],
    bubble: () => host.querySelector('[data-testid="hover-tip"]'),
  };
}

/** 悬停(合成 mouseover 冒泡到 document 上的委托) */
export function hover(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
}

/** 让某个元素被判为「被 CSS 截断」 */
export function markTruncated(el: HTMLElement): void {
  Object.defineProperty(el, 'scrollWidth', { value: 999, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
}
