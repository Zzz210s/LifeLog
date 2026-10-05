// @vitest-environment jsdom
/**
 * 树行的角色徽章 / 携带小字 / 悬浮卡片(标签角色 spec §5):
 * 徽章最多 2 个 + `+N`;携带只在开关打开时进树行,悬浮卡片(行 title)有值才列;
 * 名字被截断时才给 `title`(沿用 truncate-title 口径)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  roleNames?: readonly string[];
  carry?: readonly { role: string; value: string }[];
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
        roleNames: over.roleNames ?? [],
        carry: over.carry ?? [],
        showCarry: over.showCarry ?? false,
      })
    );
  });
  return host.querySelector('button[data-tag-path]') as HTMLElement;
}

const badgeTexts = (): string[] =>
  [...host.querySelectorAll('[data-role-badge]')].map((el) => el.textContent ?? '');
const carryTexts = (): string[] =>
  [...host.querySelectorAll('[data-tag-carry]')].map((el) => el.textContent ?? '');

describe('树行角色徽章', () => {
  it('0/1/2 个原样显示', () => {
    render();
    expect(badgeTexts()).toEqual([]);
    render({ roleNames: ['国籍'] });
    expect(badgeTexts()).toEqual(['国籍']);
    render({ roleNames: ['国籍', '所在'] });
    expect(badgeTexts()).toEqual(['国籍', '所在']);
  });

  it('超过 2 个:显示 2 个 + `+N`', () => {
    render({ roleNames: ['国籍', '所在', '要求', '产地'] });
    expect(badgeTexts()).toEqual(['国籍', '所在', '+2']);
  });

  it('徽章在名字之后、计数之前(优先级 名字 -> 角色 -> 计数 -> 携带)', () => {
    const row = render({ roleNames: ['国籍'] });
    const html = row.innerHTML;
    expect(html.indexOf('日本')).toBeLessThan(html.indexOf('data-role-badge'));
    expect(html.indexOf('data-role-badge')).toBeLessThan(html.indexOf('data-count-rail'));
  });
});

describe('树行携带小字(开关)', () => {
  const CARRY = [
    { role: '国籍', value: '日本' },
    { role: '所在', value: '' },
  ];

  it('开关关闭:树行不出现携带', () => {
    render({ carry: CARRY, showCarry: false });
    expect(carryTexts()).toEqual([]);
    expect(host.textContent).not.toContain('国籍 → 日本');
  });

  it('开关打开:末尾追加 `国籍 → 日本`,值空的只给角色名', () => {
    render({ carry: CARRY, showCarry: true });
    expect(carryTexts()).toEqual(['国籍 → 日本', '所在']);
  });
});

describe('悬浮卡片(行 title)', () => {
  it('有角色有携带:三行文案', () => {
    const row = render({ roleNames: ['国籍', '所在'], carry: [{ role: '国籍', value: '日本' }] });
    expect(row.getAttribute('title')).toBe(
      '地点轴/国籍/日本(本级 4 / 含子级 9)\n角色：国籍、所在\n携带：国籍 → 日本'
    );
  });

  it('无携带值时不出现携带行', () => {
    const row = render({ roleNames: ['国籍'] });
    expect(row.getAttribute('title')).toContain('角色：国籍');
    expect(row.getAttribute('title')).not.toContain('携带');
  });

  it('无角色无携带:只有路径与计数行', () => {
    const row = render();
    expect(row.getAttribute('title')).toBe('地点轴/国籍/日本(本级 4 / 含子级 9)');
  });

  it('名字被 CSS 截断时才给名字的 title;未截断不给', () => {
    render({ roleNames: ['国籍'] });
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
