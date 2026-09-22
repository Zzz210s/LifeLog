// @vitest-environment jsdom
/**
 * 视觉刷新 V2「笔记卡片流」的组件证据(jsdom,只看类名,不引入计算样式):
 * 卡片 = bg-raised + 1px border + radius-md(8px)+ px-4 py-3;三态互斥且都可表达;
 * 流容器用 gap-2 间距分隔,卡片上不再有 border-b;正文走 text-body 令牌(15/26);
 * 全局 :focus-visible 环不得被组件上的 outline-none 压掉。
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { NoteItem } from './NoteItem';
import { NoteStream } from './NoteStream';

// NoteStream 的编辑分支会牵到写库模块;本测试不编辑,但 import 链要能加载
vi.mock('../../shared/api', () => ({ api: { updateNote: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE: Note = {
  id: 1,
  content: '第一条正文',
  created_at: '2026-09-22 08:00:00',
  // 一条主题标签 + 一条属性标签:两排 chip 都会渲染,用来核对两排行间距一致
  tags: ['水果/苹果', '状态/想做'],
};

let root: Root;
let host: HTMLDivElement;

async function render(el: ReturnType<typeof createElement>): Promise<void> {
  await act(async () => {
    root.render(el);
  });
}

const card = (): HTMLElement => {
  const el = host.querySelector('[data-note-body]')?.closest('li');
  if (!el) throw new Error('未渲染出卡片 li');
  return el as HTMLElement;
};

/** 类名按空白切词后比对:'border-b' 是 'border-border' 的子串,直接 contains 会误报 */
const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);

const noteItem = (selected?: boolean) =>
  createElement(NoteItem, {
    note: NOTE,
    activeTags: [],
    onTagClick: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onToggleTask: () => {},
    ...(selected === undefined ? {} : { selected }),
  });

function noteStream(): ReturnType<typeof createElement> {
  return createElement(NoteStream, {
    notes: [NOTE, { ...NOTE, id: 2, content: '第二条正文' }],
    queryFailed: false,
    filterEmpty: true,
    onRetry: () => {},
    onClearFilters: () => {},
    onShowInput: () => {},
    activeTags: [],
    editingId: null,
    hasMore: false,
    loading: false,
    onLoadMore: () => {},
    onTagClick: () => {},
    onEdit: () => {},
    onSwitchEdit: () => {},
    onDelete: () => {},
    onEditSaved: () => {},
    onEditCancel: () => {},
    onToggleTask: () => {},
    onLinkError: () => {},
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  // NoteStream 的哨兵用 IntersectionObserver:jsdom 没有,给个空实现
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('V2 卡片形态:表面 + 边框 + 8px 圆角 + 内边距', () => {
  it('卡片是 bg-raised 卡片(8px 圆角、1px 边框、px-4 py-3),不再有 border-b', async () => {
    await render(noteItem());
    const cls = card().className;
    for (const token of ['bg-raised', 'border', 'border-border', 'rounded-md', 'px-4', 'py-3', 'transition-colors']) {
      expect(tokens(card())).toContain(token);
    }
    expect(tokens(card())).not.toContain('border-b');
    // 圆角档位唯一:卡片只允许 rounded-md(V1 已把 --radius-md 定为 8px)
    expect(cls).not.toContain('rounded-lg');
    expect(cls).not.toContain('rounded-sm');
  });

  it('正文走 text-body 令牌(15/26),不再用 text-sm', async () => {
    await render(noteItem());
    const body = host.querySelector('.md-body') as HTMLElement;
    expect(body.className).toContain('text-body');
    expect(body.className).not.toContain('text-sm');
    // 行高必须交给令牌:main.css 的 .md-body 若无层叠层的 1.625 会把令牌压回去
    const css = readFileSync('src/main-window/main.css', 'utf8');
    expect(css).toMatch(/\.md-body\s*\{[^}]*line-height:\s*var\(--text-body--line-height\)/);
  });

  it('卡片内标签行间距 = gap-1(4px),主题排与属性排一致', async () => {
    await render(noteItem());
    const rows = [...host.querySelectorAll('div.flex-wrap')] as HTMLElement[];
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.className).toContain('gap-1');
  });
});

describe('V2 三态:hover / selected / focus 互不冲突', () => {
  it('默认态:只有 hover:bg-hover,不含 bg-selected', async () => {
    await render(noteItem());
    const cls = card().className;
    expect(cls).toContain('hover:bg-hover');
    expect(cls).not.toContain('bg-selected');
  });

  it('选中态:bg-selected 取代 raised/hover(同一条卡片不会同时给出两种底色)', async () => {
    await render(noteItem(true));
    const cls = card().className;
    expect(cls).toContain('bg-selected');
    expect(cls).not.toContain('bg-raised');
    expect(cls).not.toContain('hover:bg-hover');
  });

  it('focus 环不被压掉:卡片与其交互元素上都没有 outline-none', async () => {
    await render(noteItem());
    expect(card().className).not.toContain('outline-none');
    for (const el of host.querySelectorAll('button')) {
      expect((el as HTMLElement).className).not.toContain('outline-none');
    }
    // 全局基元仍在:1px accent 环 + offset -1(V1 落地)
    const css = readFileSync('src/main-window/main.css', 'utf8');
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*1px solid var\(--color-accent\)/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline-offset:\s*-1px/);
  });
});

describe('V2 流容器:间距分隔取代逐条分隔线', () => {
  it('ul 是 flex 列 + gap-2 + px-4 py-3;每条卡片都不带 border-b', async () => {
    await render(noteStream());
    const ul = host.querySelector('ul') as HTMLElement;
    for (const token of ['flex', 'flex-col', 'gap-2', 'px-4', 'py-3']) expect(ul.className).toContain(token);
    const items = [...ul.querySelectorAll(':scope > li')] as HTMLElement[];
    expect(items.length).toBe(2);
    for (const li of items) {
      expect(tokens(li)).toContain('bg-raised');
      expect(tokens(li)).not.toContain('border-b');
    }
  });
});
