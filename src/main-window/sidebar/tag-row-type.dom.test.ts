// @vitest-environment jsdom
/**
 * 树行的类型徽章 / 携带小字 / 悬浮卡片(标签类型 spec §5):
 * 徽章最多 2 个 + `+N`(两个类型末段同名也不能撞 key);携带只在开关打开时进树行;
 * 悬浮卡片走行上的 `data-tip`(瞬时 HoverTip),名字被截断时才给 `title`(truncate-title 口径)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagRow } from './TagRow';
import type { TagNode } from './tag-tree';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 叶子标签(直接给 TagNode:buildTree 会把缺的祖先补成结构节点,拿不到这一行) */
const node: TagNode = {
  id: 1,
  path: '地点轴/国籍/日本',
  name: '日本',
  depth: 3,
  sortOrder: 0,
  selfCount: 4,
  subtreeCount: 9,
  children: [],
};

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

function render(over: {
  /** 类型名;id 由位置派生(同名也各不相同,专盯列表 key) */
  types?: readonly string[];
  carry?: readonly { type: string; value: string }[];
  showCarry?: boolean;
} = {}): HTMLElement {
  act(() => {
    root.render(
      createElement(TagRow, {
        node,
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
        types: (over.types ?? []).map((name, i) => ({ tagId: 100 + i, name })),
        carry: over.carry ?? [],
        showCarry: over.showCarry ?? false,
      })
    );
  });
  return host.querySelector('button[data-tag-path]') as HTMLElement;
}

const badgeTexts = (): string[] =>
  [...host.querySelectorAll('[data-type-badge]')].map((el) => el.textContent ?? '');
const carryTexts = (): string[] =>
  [...host.querySelectorAll('[data-tag-carry]')].map((el) => el.textContent ?? '');

describe('树行类型徽章', () => {
  it('0/1/2 个原样显示', () => {
    render();
    expect(badgeTexts()).toEqual([]);
    render({ types: ['国籍'] });
    expect(badgeTexts()).toEqual(['国籍']);
    render({ types: ['国籍', '所在'] });
    expect(badgeTexts()).toEqual(['国籍', '所在']);
  });

  it('两个类型末段同名:徽章 key 不重叠(React 不报重复 key)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render({ types: ['所在', '所在'] });
    expect(badgeTexts()).toEqual(['所在', '所在']);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('超过 2 个:显示 2 个 + `+N`', () => {
    render({ types: ['国籍', '所在', '要求', '产地'] });
    expect(badgeTexts()).toEqual(['国籍', '所在', '+2']);
  });

  it('徽章在名字之后、计数之前(优先级 名字 -> 类型 -> 计数 -> 携带)', () => {
    const row = render({ types: ['国籍'] });
    const html = row.innerHTML;
    expect(html.indexOf('日本')).toBeLessThan(html.indexOf('data-type-badge'));
    expect(html.indexOf('data-type-badge')).toBeLessThan(html.indexOf('data-count-rail'));
  });
});

describe('树行携带小字(开关)', () => {
  const CARRY = [
    { type: '国籍', value: '日本' },
    { type: '所在', value: '' },
  ];

  it('开关关闭:树行不出现携带', () => {
    render({ carry: CARRY, showCarry: false });
    expect(carryTexts()).toEqual([]);
    expect(host.textContent).not.toContain('国籍 → 日本');
  });

  it('开关打开:末尾追加 `国籍 → 日本`,值空的只给类型名', () => {
    render({ carry: CARRY, showCarry: true });
    expect(carryTexts()).toEqual(['国籍 → 日本', '所在']);
  });
});

describe('悬浮卡片(行 data-tip)', () => {
  it('行上不再挂原生 title(卡片改走 data-tip,不会再被名字的截断 title 吃掉)', () => {
    const row = render({ types: ['国籍'], carry: [{ type: '国籍', value: '日本' }] });
    expect(row.getAttribute('title')).toBeNull();
    expect(row.getAttribute('data-tip')).toContain('类型：国籍');
  });

  it('有类型有携带:三行文案', () => {
    const row = render({ types: ['国籍', '所在'], carry: [{ type: '国籍', value: '日本' }] });
    expect(row.getAttribute('data-tip')).toBe(
      '地点轴/国籍/日本(本级 4 / 含子级 9)\n类型：国籍、所在\n携带：国籍 → 日本'
    );
  });

  it('无携带值时不出现携带行', () => {
    const row = render({ types: ['国籍'] });
    expect(row.getAttribute('data-tip')).toContain('类型：国籍');
    expect(row.getAttribute('data-tip')).not.toContain('携带');
  });

  it('无类型无携带:只有路径与计数行', () => {
    const row = render();
    expect(row.getAttribute('data-tip')).toBe('地点轴/国籍/日本(本级 4 / 含子级 9)');
  });

  it('名字被 CSS 截断时才给名字的 title;未截断不给', () => {
    render({ types: ['国籍'] });
    const name = [...host.querySelectorAll('span')].find(
      (el) => el.textContent === '日本'
    ) as HTMLElement;
    act(() => name.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(name.getAttribute('title')).toBeNull(); // jsdom 宽度 0,未截断

    Object.defineProperty(name, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(name, 'clientWidth', { value: 100, configurable: true });
    act(() => name.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(name.getAttribute('title')).toBe('日本'); // 树模式只显示名字,提示 = 完整名字
  });
});
