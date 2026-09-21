// @vitest-environment jsdom
// 形态 A 编辑态证据(jsdom 真实渲染 EditPanel):单栏源码、#标签 回显、行数按源码推导、
// 保存按钮与点区块外保存、取消回调、标签数提示、失败留编辑态、并发删除静默退出。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { EditPanel } from './EditPanel';

const { updateNote, parseNoteSource } = vi.hoisted(() => ({
  updateNote: vi.fn(),
  parseNoteSource: vi.fn(),
}));
vi.mock('../../shared/api', () => ({ api: { updateNote, parseNoteSource } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (content: string, tags: string[] = ['水果']): Note => ({
  id: 7,
  content,
  created_at: '2026-09-21 08:00:00',
  tags,
});

let root: Root;
let host: HTMLDivElement;
let onSaved: ReturnType<typeof vi.fn>;
let onCancel: ReturnType<typeof vi.fn>;

async function mount(n: Note, extra: Record<string, unknown> = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(EditPanel, { note: n, onSaved, onCancel, ...extra }));
  });
}

/** 换一条笔记重挂:EditPanel 的源码初值只在挂载时取一次,同 root 重渲不会重跑 useState */
async function remount(n: Note): Promise<void> {
  act(() => root.unmount());
  root = createRoot(host);
  await mount(n);
}

const textarea = (): HTMLTextAreaElement => {
  const el = host.querySelector('textarea');
  if (!el) throw new Error('未找到 textarea');
  return el;
};

const setValue = (el: HTMLTextAreaElement, v: string): Promise<void> =>
  act(async () => {
    // 必须走原生 setter + input 事件才能触发 React 的 onChange
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

/** 离开编辑区块 = 保存:按钮与键盘保存均已按用户要求删除,统一用"点区块外"触发 */
const clickSave = (): Promise<void> =>
  act(async () => {
    const outside = document.body.appendChild(document.createElement('div'));
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    outside.remove();
    await Promise.resolve();
    await Promise.resolve();
  });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  updateNote.mockReset();
  parseNoteSource.mockReset();
  parseNoteSource.mockResolvedValue({ content: '', tags: [] });
  onSaved = vi.fn();
  onCancel = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('EditPanel 单栏源码版式', () => {
  it('源码含 #标签 回显;无分屏预览(md-body 不再出现)', async () => {
    await mount(note('正文'));
    expect(textarea().value).toBe('正文\n#水果');
    expect(host.querySelector('.md-body')).toBeNull();
  });

  it('行数按源码推导并钳制 4..24,可纵向拉伸手动调整', async () => {
    await mount(note('正文'));
    const el = textarea();
    expect(el.getAttribute('rows')).toBe('4'); // 2 行 -> 下限 4
    expect(el.className).toContain('resize-y');
    expect(el.className).not.toContain('h-64');
    expect(el.className).not.toContain('resize-none');
  });

  it('中段行数原样、超长钳到上限(24)', async () => {
    await mount(note(Array.from({ length: 10 }, (_, i) => '第' + i + '行').join('\n'), []));
    expect(textarea().getAttribute('rows')).toBe('10');
    await remount(note(Array.from({ length: 30 }, (_, i) => '第' + i + '行').join('\n'), []));
    expect(textarea().getAttribute('rows')).toBe('24');
  });
});

describe('EditPanel 离开区块即保存', () => {
  it('离开区块:按保存前入口归一后调 update_note,成功回调 onSaved', async () => {
    const updated = note('改后的正文', []);
    updateNote.mockResolvedValue(updated);
    await mount(note('正文'));
    await setValue(textarea(), '改后的正文   ');
    await clickSave(); // 行尾空白被裁
    expect(updateNote).toHaveBeenCalledWith(7, '改后的正文');
    expect(onSaved).toHaveBeenCalledWith(updated);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('保存失败:留在编辑态、文本不丢、显示中文失败原因', async () => {
    updateNote.mockRejectedValue(new Error('IPC 失败'));
    await mount(note('正文'));
    await setValue(textarea(), '改后的正文');
    await clickSave();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(textarea().value).toBe('改后的正文');
    expect(host.textContent).toContain('保存失败');
  });

  it('内容为空时离开区块:留在编辑态并就地给中文错误(不写库)', async () => {
    await mount(note('正文'));
    await setValue(textarea(), '   ');
    await clickSave();
    expect(updateNote).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(host.textContent).toContain('内容不能为空');
  });

  it('笔记已被并发删除(update_note 返回 null):静默退出编辑', async () => {
    updateNote.mockResolvedValue(null);
    await mount(note('正文'));
    await clickSave();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

// R4:进编辑不得改动笔记流滚动位置。原用 autoFocus(聚焦会 scrollIntoView,把被裁掉的卡片拉回视野,
// 实测 scrollTop 200 -> 0),改为显式 focus({preventScroll:true});防回归:无 autofocus 属性 + focus 带 preventScroll。
describe('R4 进编辑不改动滚动位置', () => {
  it('挂载后焦点在源码框;focus 带 preventScroll 且无 autoFocus 属性', async () => {
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus');
    await mount(note('正文'));
    const el = textarea();
    expect(document.activeElement).toBe(el);
    expect(el.getAttribute('autofocus')).toBeNull();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  it('键盘保存已删除:Ctrl+Enter 不再写库(用户 2026-09-21 明确要求)', async () => {
    updateNote.mockResolvedValue(note('改后的正文', []));
    await mount(note('正文'));
    expect(document.activeElement).toBe(textarea());
    await setValue(textarea(), '改后的正文');
    await act(async () => {
      textarea().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
      );
    });
    expect(updateNote).not.toHaveBeenCalled();
    expect(host.querySelector('textarea')).not.toBeNull(); // 仍在编辑态
  });
});

describe('EditPanel 标签数实时提示', () => {
  it('提示仍在:初始回退已保存标签数,防抖后显示解析结果', async () => {
    parseNoteSource.mockResolvedValue({ content: '', tags: ['a', 'b'] });
    await mount(note('正文', ['水果']));
    const hint = host.querySelector('[data-testid="edit-tag-count"]');
    expect(hint?.textContent).toContain('标签 1 个');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(parseNoteSource).toHaveBeenCalledWith('正文\n#水果');
    expect(host.querySelector('[data-testid="edit-tag-count"]')?.textContent).toContain('标签 2 个');
  });

  it('挂载并聚焦完成后回调 onMounted(父层据此还原流的滚动位置)', async () => {
    let calls = 0;
    await mount(note('正文'), { onMounted: () => { calls += 1; } });
    expect(calls).toBe(1);
    expect(document.activeElement).toBe(document.querySelector('textarea'));
  });
});
