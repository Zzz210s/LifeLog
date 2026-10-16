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
import { buildTree, type TagNode } from '../tag-tree';
import type { RowIntent } from '../tag-row-action';
import type { SidebarClickMode } from '../click-mode';
import type { RelationRef } from '../../../shared/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 一条关系线:v31 名字挂在**点**上(`nameText`),空串 = 无名字线(T4.3:chip 显示「名字 值」/只有值) */
export const rel = (toTagId: number, name: string, nameText = ''): RelationRef => ({
  toTagId,
  path: name,
  name,
  nameId: nameText === '' ? null : 1,
  nameText,
  lineId: 1000 + toTagId,
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

/** 单击真值表(设计 §4.1 主表 8 格):[模式, 单击修饰键, 期望意图] */
export const CLICK_TABLE: Array<[SidebarClickMode, MouseEventInit, RowIntent]> = [
  ['filter', {}, 'toggle'],
  ['filter', { ctrlKey: true }, 'andAdd'],
  ['filter', { altKey: true }, 'exclude'],
  ['filter', { shiftKey: true }, 'only'],
  ['open', {}, 'open'],
  ['open', { ctrlKey: true }, 'andAdd'],
  ['open', { altKey: true }, 'exclude'],
  ['open', { shiftKey: true }, 'only'],
];

/** 修饰键标签(用例标题):无 / Ctrl / Alt / Shift */
export const modLabel = (m: MouseEventInit): string =>
  m.ctrlKey === true ? 'Ctrl' : m.altKey === true ? 'Alt' : m.shiftKey === true ? 'Shift' : '无';

/** 合成单击(修饰键由事件属性给:实现读的就是 e.ctrlKey/altKey/shiftKey) */
export const clickRow = (el: Element, mods: MouseEventInit = {}): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...mods }));
  });
};

/** 合成键盘(返回事件本体,便于读 defaultPrevented) */
export const keyRow = (el: Element, key: string, mods: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
};

/** 合成双击(不补发两次 click:双击的净效果由设计 §3.5 的交代表给出) */
export const dblclickRow = (el: Element): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
};

/** 行 fixture = `buildTree` 的首个根(用例给 list_tags 形状的行;缺的祖先会被补成结构节点) */
export const rowFixtureTree = (rows: unknown[]): TagNode => buildTree(rows as never)[0];

export interface RowOver {
  relations?: readonly RelationRef[];
  showRelations?: boolean;
  /** 行(缺省 = LEAF);容器 / 带子级的行由用例自行传入 */
  node?: TagNode;
  /** 单击模式与预览状态(T3 行内行为) */
  mode?: SidebarClickMode;
  previewing?: boolean;
  /** 行意图出口(T4 起行只派发意图,业务在 use-tag-click);不传 = 吞掉(只读视觉的用例) */
  onIntent?: (intent: RowIntent, node: TagNode) => void;
  onToggleExpand?: (path: string) => void;
  dragActive?: boolean;
  flat?: boolean;
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
            node: over.node ?? LEAF,
            flat: over.flat ?? false,
            selected: false,
            excluded: false,
            expanded: false,
            clickMode: over.mode,
            previewing: over.previewing ?? false,
            onIntent: over.onIntent ?? (() => {}),
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
