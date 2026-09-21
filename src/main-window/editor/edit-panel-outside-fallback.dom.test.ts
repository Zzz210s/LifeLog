// 复审 C1 / I1 的回归用例:
//  C1 面板已卸载时保存失败必须交主窗错误条(不能静默,也不能丢文本)
//  I1 已有保存在飞时,连点区块外不得发第二次 updateNote
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (content: string): Note => ({
  id: 42,
  content,
  created_at: '2026-09-21 08:00:00',
  tags: ['水果'],
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount(extra: Record<string, unknown>): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      createElement(EditPanel, {
        note: note('原始正文'),
        onSaved: vi.fn(),
        onCancel: vi.fn(),
        ...extra,
      })
    );
  });
}

/** 在面板外的元素上派发一次 pointerdown(模拟点区块外) */
function clickOutside(): void {
  const outside = document.createElement('div');
  document.body.appendChild(outside);
  act(() => {
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  outside.remove();
}

/** 改一下文本域内容(触发受控 state 变化;必须走原生 setter,否则 React 的变化检测不认) */
async function type(text: string): Promise<void> {
  const ta = host?.querySelector('textarea');
  if (!ta) throw new Error('找不到文本域');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(ta, ta.value + text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
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

describe('点区块外保存:复审 C1 / I1', () => {
  it('C1 面板已卸载后保存失败 -> 交主窗错误条(不静默)', async () => {
    const onErrorFallback = vi.fn();
    // 卸载兜底也会发起一次保存:把所有在飞 promise 一起 reject,才测得到"错误交主窗"
    const pending: Array<(e: Error) => void> = [];
    updateNote.mockImplementation(() => new Promise((_res, rej) => { pending.push(rej); }));
    await mount({ onErrorFallback });
    await type('改一下');

    clickOutside(); // 触发保存(在飞)
    act(() => root?.unmount()); // 面板卸载:错误无法就地显示
    root = null;
    await act(async () => {
      pending.forEach((rej) => rej(new Error('数据库忙')));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onErrorFallback).toHaveBeenCalledTimes(1);
    expect(String(onErrorFallback.mock.calls[0][0])).toContain('数据库忙');
  });

  it('C1 面板还在时保存失败 -> 就地显示,不走主窗错误条', async () => {
    const onErrorFallback = vi.fn();
    updateNote.mockRejectedValue(new Error('数据库忙'));
    await mount({ onErrorFallback });
    await type('改一下');
    clickOutside();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onErrorFallback).not.toHaveBeenCalled();
    expect(host?.textContent).toContain('保存失败');
  });

  it('I1 保存在飞时连点两次区块外 -> 只发一次 updateNote', async () => {
    let resolveSave: ((n: Note) => void) | null = null;
    updateNote.mockImplementation(
      () => new Promise((res) => { resolveSave = res; })
    );
    await mount({});
    await type('改一下');
    clickOutside();
    clickOutside(); // 第二次点击必须被 in-flight 守卫挡下
    await act(async () => {
      resolveSave?.(note('改一下'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateNote).toHaveBeenCalledTimes(1);
  });

  it('内容未变时点区块外 -> 不写库、退出编辑', async () => {
    const onCancel = vi.fn();
    await mount({ onCancel });
    clickOutside();
    await act(async () => {
      await Promise.resolve();
    });
    expect(updateNote).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
