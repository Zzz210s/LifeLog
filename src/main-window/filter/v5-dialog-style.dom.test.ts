// @vitest-environment jsdom
/**
 * 视觉刷新 V5 的对话框证据(设计 §4-9/§4-11):
 * 容器 rounded-lg(12)+ shadow-lg + 遮罩 bg-overlay;标题 text-title;内部控件 32 高 / rounded-sm / --text-ui;
 * 按钮复用 shell/button-classes 的三型(不再各自写 h-8 rounded-md text-xs)。
 * 覆盖:表达式对话框、标签选择对话框、「添加条件」下拉菜单。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddConditionMenu } from './AddConditionMenu';
import { ExprDialog } from './ExprDialog';
import { TagPickDialog } from './TagPickDialog';
import { EMPTY_FILTER } from '../../shared/filter-conditions';

vi.mock('../../shared/api', () => ({
  api: {
    listTags: () =>
      Promise.resolve([
        { id: 1, path: '工作', depth: 1, self_count: 1, subtree_count: 2 },
        { id: 2, path: '工作/会议', depth: 2, self_count: 1, subtree_count: 1 },
      ]),
    validateExpr: () => Promise.resolve({ ok: true, preview: '', message: '', position: null }),
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
const render = (el: ReturnType<typeof createElement>): void => {
  act(() => root.render(el));
};
const dialog = (label: string): HTMLElement =>
  host.querySelector(`[role="dialog"][aria-label="${label}"]`) as HTMLElement;
const button = (text: string): HTMLElement =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLElement;

describe('V5 表达式对话框:rounded-lg + shadow-lg + 遮罩', () => {
  it('容器圆角 12、阴影 lg、遮罩 bg-overlay(不再 shadow-xl)', () => {
    render(createElement(ExprDialog, { value: null, onClose: () => {}, onSave: () => {} }));
    const d = tokens(dialog('表达式'));
    expect(d).toContain('rounded-lg');
    expect(d).toContain('shadow-lg');
    expect(d).toContain('bg-raised');
    expect(d).not.toContain('shadow-xl');
    const overlay = tokens(dialog('表达式').parentElement as HTMLElement);
    expect(overlay).toContain('bg-overlay');
    expect(overlay).toContain('inset-0');
  });

  it('标题 text-title;内部输入框 32 档口径(rounded-sm + text-ui)', () => {
    render(createElement(ExprDialog, { value: null, onClose: () => {}, onSave: () => {} }));
    const h2 = dialog('表达式').querySelector('h2') as HTMLElement;
    expect(tokens(h2)).toContain('text-title');
    expect(tokens(h2)).not.toContain('text-sm');

    const ta = dialog('表达式').querySelector('textarea') as HTMLElement;
    const t = tokens(ta);
    for (const token of ['rounded-sm', 'text-ui', 'font-mono', 'resize-y']) expect(t).toContain(token);
    expect(t).not.toContain('rounded-md');
    expect(t).not.toContain('text-sm');
  });

  it('按钮三型:取消/清空 = 次按钮档,确定 = 主按钮档,关闭 = 图标档', () => {
    render(createElement(ExprDialog, { value: null, onClose: () => {}, onSave: () => {} }));
    for (const label of ['取消', '清空']) {
      const t = tokens(button(label));
      expect(t, label).toContain('h-8');
      expect(t, label).toContain('rounded-sm');
      expect(t, label).toContain('text-ui');
      expect(t, label).toContain('border');
      expect(t, label).not.toContain('rounded-md');
      expect(t, label).not.toContain('text-xs');
    }
    const ok = tokens(button('确定'));
    expect(ok).toContain('bg-accent');
    expect(ok).toContain('text-on-accent');
    expect(ok).toContain('rounded-sm');
    const close = tokens(host.querySelector('button[aria-label="关闭"]') as HTMLElement);
    expect(close).toContain('h-7');
    expect(close).toContain('w-7');
    expect(close).toContain('rounded-sm');
  });

  it('回归:Esc 关闭不保存;确定与清空各自回调(空表单不触发 IPC 校验)', () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(createElement(ExprDialog, { value: 'a', onClose, onSave }));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => button('清空').click());
    expect(onSave).toHaveBeenCalledWith('');

    render(createElement(ExprDialog, { value: null, onClose, onSave }));
    act(() => button('确定').click());
    expect(onSave).toHaveBeenCalledWith('');
  });
});

describe('V5 标签选择对话框:同一浮层口径', () => {
  it('容器 rounded-lg + shadow-lg + 遮罩;标题 text-title;列表容器 rounded-md', async () => {
    render(createElement(TagPickDialog, { exclude: false, selected: [], onClose: () => {}, onPick: () => {} }));
    await flush();
    const d = tokens(dialog('添加标签'));
    expect(d).toContain('rounded-lg');
    expect(d).toContain('shadow-lg');
    expect(d).not.toContain('shadow-xl');
    expect(tokens(dialog('添加标签').parentElement as HTMLElement)).toContain('bg-overlay');
    const h2 = dialog('添加标签').querySelector('h2') as HTMLElement;
    expect(tokens(h2)).toContain('text-title');
    expect(tokens(dialog('添加标签').querySelector('ul') as HTMLElement)).toContain('rounded-md');
  });

  it('列表行高 30(text-ui + py-1.5);计数走 text-label + muted', async () => {
    render(createElement(TagPickDialog, { exclude: false, selected: [], onClose: () => {}, onPick: () => {} }));
    await flush();
    const row = dialog('添加标签').querySelector('ul button') as HTMLElement;
    const t = tokens(row);
    for (const token of ['text-ui', 'py-1.5', 'px-2.5', 'gap-2']) expect(t).toContain(token);
    expect(t).not.toContain('text-xs');
    const count = row.lastElementChild as HTMLElement;
    expect(tokens(count)).toContain('text-label');
    expect(tokens(count)).toContain('text-muted');
  });

  it('回归:点行回传路径与「含子级」开关值;Esc 关闭', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(createElement(TagPickDialog, { exclude: false, selected: [], onClose, onPick }));
    await flush();
    act(() => (dialog('添加标签').querySelector('ul button') as HTMLElement).click());
    expect(onPick).toHaveBeenCalledWith('工作', true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('V5 添加条件下拉:菜单浮层口径', () => {
  const menu = (): HTMLElement => host.querySelector('[role="menu"]') as HTMLElement;
  const open = (over: Partial<Parameters<typeof AddConditionMenu>[0]> = {}): Record<string, unknown> => {
    const props = {
      conditions: EMPTY_FILTER,
      onPatch: vi.fn(),
      onPickTag: vi.fn(),
      onOpenExpr: vi.fn(),
      ...over,
    };
    render(createElement(AddConditionMenu, props));
    act(() => (button('添加条件') as HTMLElement).click());
    return props;
  };

  it('菜单容器 rounded-lg + shadow-lg;菜单项 rounded-xs + text-ui(高 30)', () => {
    open();
    const t = tokens(menu());
    expect(t).toContain('rounded-lg');
    expect(t).toContain('shadow-lg');
    const item = menu().querySelector('button[role="menuitem"]') as HTMLElement;
    expect(tokens(item)).toContain('rounded-xs');
    expect(tokens(item)).toContain('text-ui');
    expect(tokens(item)).not.toContain('text-xs');
  });

  it('回归:点「标签」回传 includeChildren=false', () => {
    const props = open();
    act(() => (button('标签') as HTMLElement).click());
    expect(props.onPickTag).toHaveBeenCalledWith(false);
  });

  it('回归:「表达式(高级)」入口仍打开对话框', () => {
    const props = open();
    act(() => (button('表达式(高级)') as HTMLElement).click());
    expect(props.onOpenExpr).toHaveBeenCalledTimes(1);
  });
});
