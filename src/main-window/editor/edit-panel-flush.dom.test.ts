// @vitest-environment jsdom
/**
 * EditPanel 把 flush 登记进命令通道(自已删的 `palette-leave-save.dom.test.ts` 保留):
 * 浮层那半随浮层外壳删除,登记这半仍钉住活代码 —— 命令执行前的 flush 只对活着的面板生效。
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { EditPanel } from './EditPanel';
import { hasEditingPanel } from './edit-flush';

const { updateNote, parseNoteSource } = vi.hoisted(() => ({
  updateNote: vi.fn(async () => null),
  parseNoteSource: vi.fn(async () => ({ content: '', tags: [] })),
}));
vi.mock('../../shared/api', () => ({ api: { updateNote, parseNoteSource } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('EditPanel 把 flush 登记进命令通道', () => {
  it('编辑面板在场 -> 已登记;卸载 -> 注销(命令执行前的 flush 只对活着的面板生效)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const note: Note = { id: 7, content: '买牛奶', created_at: '2026-09-22 10:00:00', tags: [] };
    expect(hasEditingPanel()).toBe(false);
    await act(async () => {
      root.render(createElement(EditPanel, { note, onSaved: () => {}, onCancel: () => {} }));
    });
    expect(hasEditingPanel()).toBe(true);
    act(() => root.unmount());
    expect(hasEditingPanel()).toBe(false);
    host.remove();
  });
});
