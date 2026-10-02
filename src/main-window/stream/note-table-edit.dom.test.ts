// 表格单元格编辑与正文既有交互的接线证据(设计 §1 T7 / 计划 Task 4 Step 1):
//   点单元格文字 -> 开覆盖编辑框,且不进整条笔记编辑;
//   chip ([data-note-link]) 与任务复选框 -> 不接管,既有行为独占这次点击;
//   点表格外的正文 -> 仍是整条笔记编辑(现状不变);
//   自校验失败的怪表 -> 退化成整条编辑(绝不猜)。
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { NoteItem } from './NoteItem';

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));
vi.mock('../../shared/api', () => ({ api: { updateNote: vi.fn() } }));
vi.mock('../data/tags-changed', () => ({ notifyTagsChanged: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (content: string): Note => ({ id: 5, content, links: [], tags: [], created_at: '2026-10-02 08:00:00' });

const TABLE = ['表格测试', '| 甲 | 乙 |', '| --- | --- |', '| [[未解析]] | 2 |', '', '表格外的正文'].join('\n');

interface Calls { edit: number; unresolved: string[]; chips: string[] }

let root: Root;
let host: HTMLDivElement;
let calls: Calls;

async function mount(n: Note): Promise<void> {
  calls = { edit: 0, unresolved: [], chips: [] };
  await act(async () => {
    root.render(
      createElement(NoteItem, {
        note: n,
        activeTags: [],
        onTagClick: (t) => calls.chips.push(t),
        onEdit: () => { calls.edit++; },
        onDelete: () => {},
        onToggleTask: () => {},
        onUnresolvedNote: (title) => calls.unresolved.push(title),
      })
    );
  });
}

const click = (el: Element): Promise<void> =>
  act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });

const pick = (sel: string): Element => {
  const el = host.querySelector(sel);
  if (!el) throw new Error('未找到元素: ' + sel);
  return el;
};
const editorOpen = (): boolean => host.querySelector('[data-testid="table-cell-editor"]') != null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('表格单元格编辑与既有交互共存', () => {
  it('点单元格文字:开覆盖编辑框,不进整条笔记编辑', async () => {
    await mount(note(TABLE));
    // 第二列那一格(不含 chip),点它进单元格编辑
    const td = pick('[data-note-body="5"] tbody tr td:nth-child(2)');
    await click(td);
    expect(editorOpen()).toBe(true);
    expect(calls.edit).toBe(0);
    // 编辑框里是该格源码文本
    expect((pick('[data-testid="table-cell-editor"] textarea') as HTMLTextAreaElement).value).toBe('2');
  });

  it('点表格里的 chip:不进单元格编辑,交给既有跳转(未解析 -> 预填)', async () => {
    await mount(note(TABLE));
    const chip = pick('[data-note-body="5"] [data-note-link]');
    await click(chip);
    expect(editorOpen()).toBe(false);
    expect(calls.unresolved).toEqual(['未解析']);
    expect(calls.edit).toBe(0);
  });

  it('点表格外的正文:仍是整条笔记编辑', async () => {
    await mount(note(TABLE));
    await click(pick('[data-note-body="5"] p'));
    expect(editorOpen()).toBe(false);
    expect(calls.edit).toBe(1);
  });

  it('自校验失败的怪表(围栏里的假表):不接管,退化成整条编辑', async () => {
    const fenced = ['围栏', '', '```', '| 假 | 表 |', '| --- | --- |', '| 1 | 2 |', '```', '', '正文'].join('\n');
    await mount(note(fenced));
    await click(pick('[data-note-body="5"] code'));
    expect(editorOpen()).toBe(false);
    expect(calls.edit).toBe(1);
  });
});
