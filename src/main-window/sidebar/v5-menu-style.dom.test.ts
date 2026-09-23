// @vitest-environment jsdom
/**
 * 视觉刷新 V5 的标签右键菜单(对话框类浮层)证据:
 * 容器 rounded-lg + shadow-lg;菜单项 rounded-xs + --text-ui(高 30);
 * 子面板内部控件 32 档口径(rounded-sm + border-border-strong + --text-ui);
 * 底部动作按钮复用 shell/button-classes(次按钮 / 主按钮 / 危险主按钮),
 * 说明文字一律 text-label + muted(白底 faint 不达标)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagMenu } from './TagMenu';
import { buildTree } from './tag-tree';
import type { ManagedNode } from './tag-tree';

vi.mock('../../shared/api', () => ({
  api: {
    tagImpact: () => Promise.resolve({ tags: 1, notes: 2 }),
    listTagAliases: () => Promise.resolve(['旧名']),
  },
}));

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

const tokens = (el: Element): string[] => String(el.className).split(/\s+/).filter(Boolean);
const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const node = buildTree([
  { id: 1, path: '工作', depth: 1, self_count: 1, subtree_count: 2 },
  { id: 2, path: '工作/会议', depth: 2, self_count: 1, subtree_count: 1 },
] as never)[0] as ManagedNode;

function render(onClose = vi.fn(), onDone = vi.fn()): { onClose: typeof onClose; onDone: typeof onDone } {
  act(() => {
    root.render(
      createElement(TagMenu, {
        node,
        x: 10,
        y: 10,
        tagRows: [{ id: 1, path: '工作', depth: 1, self_count: 1, subtree_count: 2 }] as never,
        onClose,
        onDone,
      })
    );
  });
  return { onClose, onDone };
}

const menu = (): HTMLElement => host.querySelector('[data-tag-menu]') as HTMLElement;
const item = (text: string): HTMLElement =>
  [...host.querySelectorAll('[role="menuitem"], button')].find(
    (b) => b.textContent?.trim() === text
  ) as HTMLElement;

describe('V5 标签菜单容器与菜单项', () => {
  it('容器 rounded-lg(浮层档)+ shadow-lg,不再是 rounded-md', () => {
    render();
    const t = tokens(menu());
    expect(t).toContain('rounded-lg');
    expect(t).toContain('shadow-lg');
    expect(t).toContain('bg-raised');
    expect(t).not.toContain('rounded-md');
  });

  it('菜单项 = rounded-xs + text-ui + py-1.5(高 30),悬停 accent-soft/accent-text', () => {
    render();
    const t = tokens(item('重命名'));
    for (const token of ['rounded-xs', 'text-ui', 'py-1.5', 'px-2.5', 'hover:bg-accent-soft', 'hover:text-accent-text'])
      expect(t, token).toContain(token);
    expect(t).not.toContain('text-xs');
    expect(t).not.toContain('rounded');
  });

  it('主面板标题走 text-label + muted(白底不用 faint)', () => {
    render();
    const head = menu().querySelector('p') as HTMLElement;
    expect(tokens(head)).toContain('text-label');
    expect(tokens(head)).toContain('text-muted');
    expect(tokens(head)).not.toContain('text-faint');
    expect(head.textContent).toContain('工作');
  });
});

describe('V5 子面板:控件 32 档 / 按钮三型 / 说明 text-label', () => {
  it('重命名面板:输入框 h-8 + rounded-sm + border-border-strong + text-ui;取消/确定分属次/主档', () => {
    render();
    act(() => item('重命名').click());
    const input = host.querySelector('input[aria-label="新标签名"]') as HTMLElement;
    const t = tokens(input);
    for (const token of ['h-8', 'rounded-sm', 'border-border-strong', 'text-ui']) expect(t, token).toContain(token);
    expect(t).not.toContain('rounded');
    expect(t).not.toContain('text-xs');

    const cancel = tokens(item('取消'));
    expect(cancel).toContain('h-8');
    expect(cancel).toContain('rounded-sm');
    expect(cancel).toContain('text-ui');
    expect(cancel).toContain('border');
    const ok = tokens(item('确定'));
    expect(ok).toContain('bg-accent');
    expect(ok).toContain('text-on-accent');
    expect(ok).toContain('rounded-sm');
    expect(tokens(menu().querySelector('p') as HTMLElement)).toContain('text-label');
  });

  it('删除面板:确认用危险主按钮档(32/r6),说明与影响面走 text-label + muted', async () => {
    render();
    act(() => item('删除').click());
    await flush();
    const danger = tokens(item('确认删除'));
    expect(danger).toContain('h-8');
    expect(danger).toContain('rounded-sm');
    expect(danger).toContain('bg-danger');
    expect(danger).toContain('text-on-danger');
    expect(danger).toContain('text-ui');
    const ps = [...menu().querySelectorAll('p')] as HTMLElement[];
    expect(tokens(ps[0])).toContain('text-label');
    expect(tokens(ps[1])).toContain('text-muted');
    expect(ps[1].textContent).toContain('2');
  });

  it('别名面板:列表行 text-label、删除按钮 = 纯文字档(28/r6),输入框 32 档', async () => {
    render();
    act(() => item('别名…').click());
    await flush();
    const del = item('删除');
    const t = tokens(del);
    expect(t).toContain('h-7');
    expect(t).toContain('rounded-sm');
    expect(t).toContain('text-ui');
    expect(t).toContain('hover:text-danger');
    const input = host.querySelector('input[aria-label="新别名"]') as HTMLElement;
    for (const token of ['h-8', 'rounded-sm', 'border-border-strong', 'text-ui']) expect(tokens(input)).toContain(token);
  });

  it('移动面板:候选行同为菜单项档,说明走 text-label', () => {
    render();
    act(() => item('移动').click());
    const cand = [...menu().querySelectorAll('button')].find((b) => b.textContent?.includes('(根级)')) as HTMLElement;
    expect(tokens(cand)).toContain('rounded-xs');
    expect(tokens(cand)).toContain('text-ui');
    expect(tokens(menu().querySelector('p') as HTMLElement)).toContain('text-label');
  });
});

describe('V5 标签菜单回归:关闭手势与入口不变', () => {
  it('Esc 关闭(Esc 仍被捕获阶段拦下,不冒泡到窗口级)', () => {
    const { onClose } = render();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(ev);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('菜单外 mousedown 关闭;点取消回主流程', () => {
    const { onClose } = render();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    const again = render();
    act(() => item('重命名').click());
    act(() => item('取消').click());
    expect(again.onClose).toHaveBeenCalledTimes(1);
  });
});
