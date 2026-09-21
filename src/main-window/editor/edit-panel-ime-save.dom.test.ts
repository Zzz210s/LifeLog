// 回归用例(用户 2026-09-21 报的真实缺陷):
//   真实输入法(中文 IME)组合期间,受控 textarea 的 React state 不跟上 -> "点区块外保存"拿旧 state
//   与初始值比较、判成"未变"而静默丢弃刚打的字(实测:组合中/组合上屏两条路径都不落库)。
//   修法:源码框改非受控、保存一律读 DOM 值;本文件用"直接改 DOM 值但不派发 input 事件"来模拟
//   "React state 没跟上"这一状态,断言保存仍能拿到 DOM 里的字。
// @vitest-environment jsdom
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
vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (content: string): Note => ({
  id: 9,
  content,
  created_at: '2026-09-21 08:00:00',
  tags: ['水果'],
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const textarea = (): HTMLTextAreaElement => {
  const el = host?.querySelector('textarea');
  if (!el) throw new Error('未找到 textarea');
  return el;
};

async function mount(extra: Record<string, unknown> = {}): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      createElement(EditPanel, { note: note('原始正文'), onSaved: vi.fn(), onCancel: vi.fn(), ...extra })
    );
  });
}

/** 只改 DOM 值、**不**派发 input 事件:模拟输入法组合期间 React state 未跟上 */
function setDomOnly(v: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(textarea(), v);
  });
}

/** 点面板外的元素(触发"离开区块即保存") */
async function clickOutside(): Promise<void> {
  const outside = document.createElement('div');
  document.body.appendChild(outside);
  await act(async () => {
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
  outside.remove();
}

beforeEach(() => {
  updateNote.mockReset();
  parseNoteSource.mockResolvedValue({ content: '', tags: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('输入法组合中的字也必须落库(读 DOM 而不是 React state)', () => {
  it('DOM 有字而 state 未跟上 -> 点区块外仍把 DOM 里的字写库', async () => {
    updateNote.mockResolvedValue(note('原始正文组合中的字'));
    const onCancel = vi.fn();
    await mount({ onCancel });
    setDomOnly('原始正文组合中的字'); // state 仍是「原始正文」
    await clickOutside();
    expect(updateNote.mock.calls).toEqual([[9, '原始正文组合中的字']]);
    expect(onCancel).not.toHaveBeenCalled(); // 不是"未变退出"这条分支
  });

  it('DOM 与 state 都未变 -> 点区块外不写库、退出编辑', async () => {
    const onCancel = vi.fn();
    await mount({ onCancel });
    await clickOutside();
    expect(updateNote).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('保存按钮同样读 DOM(组合中的字不会丢)', async () => {
    updateNote.mockResolvedValue(note('原始正文组合中的字'));
    await mount();
    setDomOnly('原始正文组合中的字');
    await act(async () => {
      const btn = Array.from(host?.querySelectorAll('button') ?? []).find(
        (b) => b.textContent.trim() === '保存'
      );
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateNote).toHaveBeenCalledWith(9, '原始正文组合中的字');
  });

  it('组合结束事件会把 DOM 值同步进 state(派生 UI 如行数跟着走)', async () => {
    await mount();
    setDomOnly('一\n二\n三\n四\n五\n六');
    await act(async () => {
      textarea().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    expect(textarea().getAttribute('rows')).toBe('6');
  });
});
