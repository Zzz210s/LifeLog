// @vitest-environment jsdom
/**
 * 分组组头与分组信息流(设计 §6.2/§6.4):组名 + 条数 + 折叠(原生 button,Enter/Space 可切);
 * 折叠只隐藏本组,组内「加载更多」按组独立。V5 档位在本文件钉住(并登记进源码门禁清单)。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import type { NoteGroup } from '../data/use-grouped-notes';
import { GroupHeader } from './GroupHeader';
import { GroupLog } from './GroupLog';

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

const note = (id: number): Note => ({ id, content: `笔记${id}`, created_at: '2026-10-06 10:00:00', tags: [], links: [] });
const group = (sessionKey: string, ids: number[], over: Partial<NoteGroup> = {}): NoteGroup => ({
  key: sessionKey,
  sessionKey,
  label: sessionKey,
  count: ids.length,
  notes: ids.map(note),
  hasMore: false,
  ...over,
});
const render = (el: ReactNode): void => act(() => root.render(el));
const tokens = (el: Element): string[] => String(el.className).split(/\s+/).filter(Boolean);
const headers = (): HTMLElement[] => [...host.querySelectorAll('[data-testid="group-header"]')] as HTMLElement[];

describe('GroupHeader:组名 + 条数 + 折叠', () => {
  it('是原生 button(可聚焦),aria-expanded 表达折叠态,条数是组总数', () => {
    render(createElement(GroupHeader, { label: '美国', count: 169, collapsed: false, onToggle: () => {} }));
    const h = headers()[0];
    expect(h.tagName).toBe('BUTTON');
    expect(h.tabIndex).toBe(0);
    expect(h.getAttribute('aria-expanded')).toBe('true');
    expect(h.textContent).toContain('美国');
    expect(h.textContent).toContain('169 条');
  });

  it('折叠态 aria-expanded=false;点击调 onToggle', () => {
    const onToggle = vi.fn();
    render(createElement(GroupHeader, { label: '（无 地点）', count: 593, collapsed: true, onToggle }));
    const h = headers()[0];
    expect(h.getAttribute('aria-expanded')).toBe('false');
    act(() => h.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('键盘可达:button 原生语义 + Tab 焦点(tabIndex 0),无越档字号/圆角', () => {
    render(createElement(GroupHeader, { label: '美国', count: 1, collapsed: false, onToggle: () => {} }));
    const t = tokens(headers()[0]);
    expect(headers()[0].tabIndex).toBe(0);
    expect(t).toContain('rounded-xs');
    expect(t).toContain('text-ui');
    for (const bad of ['text-xs', 'text-sm', 'rounded-md', 'h-6', 'h-9']) expect(t).not.toContain(bad);
  });
});

describe('GroupLog:折叠隔离与按组续页', () => {
  const renderNote = (n: Note): ReactNode => createElement('li', { key: n.id, 'data-testid': `note-${n.id}` }, n.id);

  it('两个组各自渲染组头与卡片', () => {
    render(
      createElement(GroupLog, {
        groups: [group('地点/美国', [1, 2]), group('地点/英国', [3])],
        collapsed: new Set<string>(),
        loadingGroup: null,
        onToggle: () => {},
        onLoadMore: () => {},
        renderNote,
      }),
    );
    expect(headers()).toHaveLength(2);
    expect(host.querySelectorAll('[data-testid="group-section"]')).toHaveLength(2);
    expect(host.querySelector('[data-testid="note-1"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="note-3"]')).not.toBeNull();
  });

  it('折叠一个组只隐藏它,别的组卡片仍在', () => {
    const props = {
      groups: [group('地点/美国', [1]), group('地点/英国', [3])],
      collapsed: new Set<string>(['地点/美国']),
      loadingGroup: null,
      onToggle: () => {},
      onLoadMore: () => {},
      renderNote,
    };
    render(createElement(GroupLog, props));
    expect(host.querySelector('[data-testid="note-1"]')).toBeNull();
    expect(host.querySelector('[data-testid="note-3"]')).not.toBeNull();
  });

  it('点组头回传该组的会话键(不误触别组)', () => {
    const onToggle = vi.fn();
    render(
      createElement(GroupLog, {
        groups: [group('地点/美国', [1]), group('地点/英国', [3])],
        collapsed: new Set<string>(),
        loadingGroup: null,
        onToggle,
        onLoadMore: () => {},
        renderNote,
      }),
    );
    act(() => headers()[1].click());
    expect(onToggle).toHaveBeenCalledWith('地点/英国');
  });

  it('「加载更多」按组独立:只给 hasMore 的组,点它回传本组键', () => {
    const onLoadMore = vi.fn();
    render(
      createElement(GroupLog, {
        groups: [group('地点/美国', [1], { count: 30, hasMore: true }), group('地点/英国', [3])],
        collapsed: new Set<string>(),
        loadingGroup: null,
        onToggle: () => {},
        onLoadMore,
        renderNote,
      }),
    );
    const more = [...host.querySelectorAll('[data-testid="group-more"]')] as HTMLElement[];
    expect(more).toHaveLength(1);
    expect(more[0].textContent).toContain('已 1 / 30 条');
    act(() => more[0].click());
    expect(onLoadMore).toHaveBeenCalledWith('地点/美国');
  });
});
