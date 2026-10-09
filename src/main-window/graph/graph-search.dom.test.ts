// @vitest-environment jsdom
/**
 * 图内搜索框(G2 Task 7):输入即出候选、Enter 取第一条、Esc 清空收列表并**拦下传播**。
 * Esc 那条是重点:图外壳在 window 上监听 Esc 回信息流,不拦就会在用户想取消搜索时把视图关掉。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../shared/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { GraphSearch } from './GraphSearch';

const node = (id: number, path: string): GraphNode => ({
  id,
  path,
  depth: 2,
  parent: null,
  notes: id,
  selfCount: id,
  sortOrder: 0,
});

const nodes: GraphNode[] = [node(1, '地点/所在/中国'), node(2, '地点/所在/四川省'), node(3, '状态/已完成')];

let root: Root;
let host: HTMLDivElement;

const render = (onPick: (n: GraphNode) => void): void => {
  act(() => {
    root.render(createElement(GraphSearch, { nodes, onPick }));
  });
};

const input = (): HTMLInputElement => host.querySelector<HTMLInputElement>('[data-testid="graph-search-input"]')!;
const items = (): NodeListOf<HTMLButtonElement> => host.querySelectorAll('[data-testid="graph-search-item"]');

/** 受控 input:React 认的是原生 setter 之后的 input 事件 */
const type = (v: string): void => {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const press = (key: string): void => {
  act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('GraphSearch:候选与采纳', () => {
  it('输入即出候选(子序列命中),Enter 取第一条并交回该节点', () => {
    const onPick = vi.fn();
    render(onPick);
    type('川省');
    expect([...items()].map((b) => b.textContent)).toEqual(['地点/所在/四川省']);
    press('Enter');
    expect(onPick.mock.calls[0][0].id).toBe(2);
    expect(host.querySelector('[data-testid="graph-search-list"]')).toBeNull(); // 采纳后收列表
  });

  it('候选最多 8 条(计划口径)', () => {
    render(() => {});
    act(() => {
      root.render(createElement(GraphSearch, { nodes: Array.from({ length: 12 }, (_, i) => node(i + 1, `地点/${i}`)), onPick: () => {} }));
    });
    type('地点');
    expect(items()).toHaveLength(8);
  });

  it('没有匹配时说明白,不装作没输入', () => {
    render(() => {});
    type('zzz');
    expect(host.textContent).toContain('没有匹配的实体');
    press('Enter'); // 没有候选时 Enter 不做事(也不抛)
    expect(host.querySelector('[data-testid="graph-search-list"]')).not.toBeNull();
  });
});

describe('GraphSearch:Esc', () => {
  it('有输入时清空收列表,且不让这次 Esc 冒到 window(否则整个关系图会被关掉)', () => {
    const win = vi.fn();
    window.addEventListener('keydown', win);
    try {
      render(() => {});
      type('中国');
      expect(items().length).toBeGreaterThan(0);
      press('Escape');
      expect(input().value).toBe('');
      expect(host.querySelector('[data-testid="graph-search-list"]')).toBeNull();
      expect(win).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', win);
    }
  });

  it('本来就没输入时不拦:Esc 照常上行(视图退回信息流)', () => {
    const win = vi.fn();
    window.addEventListener('keydown', win);
    try {
      render(() => {});
      press('Escape');
      expect(win).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', win);
    }
  });
});
