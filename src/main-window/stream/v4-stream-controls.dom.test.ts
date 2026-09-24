// @vitest-environment jsdom
/**
 * 视觉刷新 V4 的组件证据(信息流三件:唯一输入框 / 卡片内联动作 / 空态按钮):
 * 输入区 py-2(y-3 已去掉)→ 输入框 32 高 + 圆角 + 强边 + --text-ui,保存 = 主按钮档;
 * 卡片「删除」与空态按钮分别落到 28 / 32 档;保存与删除行为不变。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { UnifiedInput } from '../unified/UnifiedInput';
import { NoteItem } from './NoteItem';
import { NoteStream } from './NoteStream';

const { saveInputNote } = vi.hoisted(() => ({ saveInputNote: vi.fn(async (_text: string) => ({ id: 1 })) }));
vi.mock('../../shared/api', () => ({ api: { saveInputNote } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

async function render(el: ReturnType<typeof createElement>): Promise<void> {
  await act(async () => {
    root.render(el);
  });
}

const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);

beforeEach(() => {
  saveInputNote.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
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
  vi.unstubAllGlobals();
});

const NOTE: Note = { id: 1, content: '第一条正文', created_at: '2026-09-22 08:00:00', tags: [] };

describe('V4 唯一输入框:区高收紧,输入框与保存按钮同档', () => {
  it('区容器 py-2(不再是 py-3),输入框与保存按钮同一行 gap-2', async () => {
    await render(createElement(UnifiedInput, { onSaved: () => {}, editing: false }));
    const box = host.querySelector('textarea') as HTMLElement;
    const section = box.parentElement?.parentElement as HTMLElement;
    expect(tokens(section)).toContain('py-2');
    expect(tokens(section)).not.toContain('py-3');
    expect(tokens(section)).toContain('border-b');
    // 保存按钮与输入框同一行(items-start + gap-2);算术见 .superpowers/sdd/2026-09-22-visual/V4-report.md
    expect(tokens(box.parentElement as HTMLElement)).toContain('gap-2');
  });

  it('输入框 h-8 / rounded-sm / border-border-strong / text-ui(不再 rounded-lg + text-sm)', async () => {
    await render(createElement(UnifiedInput, { onSaved: () => {}, editing: false }));
    const box = host.querySelector('textarea') as HTMLElement;
    for (const token of ['h-8', 'rounded-sm', 'border-border-strong', 'text-ui', 'resize-none']) {
      expect(tokens(box)).toContain(token);
    }
    for (const stale of ['rounded-lg', 'rounded', 'text-sm', 'focus:border-accent']) {
      expect(tokens(box)).not.toContain(stale);
    }
  });

  it('保存 = 主按钮档(accent 底 / 32 / rounded-sm / text-ui)', async () => {
    await render(createElement(UnifiedInput, { onSaved: () => {}, editing: false }));
    const save = [...host.querySelectorAll('button')].find((b) => b.textContent === '保存') as HTMLElement;
    for (const token of ['h-8', 'rounded-sm', 'text-ui', 'bg-accent', 'text-on-accent']) {
      expect(tokens(save)).toContain(token);
    }
    expect(tokens(save)).not.toContain('text-sm');
  });

  it('回归:输入后点保存走 saveInputNote,成功后清空并回调 onSaved', async () => {
    const saved: number[] = [];
    await render(createElement(UnifiedInput, { onSaved: () => saved.push(1), editing: false }));
    const box = host.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      // 受控输入必须走原生 setter:直接赋 value 会被 React 的 value tracker 当成「没变」
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(box, '记一条 #测试');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = [...host.querySelectorAll('button')].find((b) => b.textContent === '保存') as HTMLElement;
    await act(async () => save.click());
    expect(saveInputNote).toHaveBeenCalledTimes(1);
    expect(saveInputNote.mock.calls[0][0]).toContain('#测试');
    expect(saved).toHaveLength(1);
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });
});

describe('V4 卡片内联动作与空态按钮', () => {
  it('卡片「删除」是 28 档文字按钮(h-7 / rounded-sm / text-ui),不再裸 text-xs', async () => {
    await render(
      createElement(NoteItem, {
        note: NOTE,
        activeTags: [],
        onTagClick: () => {},
        onEdit: () => {},
        onDelete: () => {},
        onToggleTask: () => {},
      })
    );
    const del = [...host.querySelectorAll('button')].find((b) => b.textContent === '删除') as HTMLElement;
    for (const token of ['h-7', 'rounded-sm', 'text-ui']) expect(tokens(del)).toContain(token);
    expect(tokens(del)).not.toContain('text-xs');
    // 卡片本体仍是 V2 的卡片口径(本阶段没动它)
    const card = host.querySelector('[data-note-body]')?.closest('li') as HTMLElement;
    expect(tokens(card)).toContain('rounded-md');
  });

  it('空态按钮是次按钮档(h-8 / rounded-sm / text-ui)', async () => {
    await render(
      createElement(NoteStream, {
        notes: [],
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
      })
    );
    const btn = host.querySelector('button') as HTMLElement;
    for (const token of ['h-8', 'rounded-sm', 'text-ui', 'border']) expect(tokens(btn)).toContain(token);
    expect(tokens(btn)).not.toContain('text-xs');
  });
});
