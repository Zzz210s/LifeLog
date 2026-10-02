// @vitest-environment jsdom
/**
 * 输入栏 `[[` 笔记补全的组件级证据(设计 N3 的读数 3,覆盖读数 4/5/7 的同款口径):
 * 打 `[[` 出候选 -> 打字收窄并高亮 -> Enter/点击采纳(`[[标题]]` + 光标落末尾,不存笔记)->
 * Esc 只收面板不动正文 -> 围栏代码块里不弹(也不取池)-> `]]` 出现即退出 -> IME 组合中不采纳。
 * 夹具见 `completions-test-kit.ts`(真 textarea + 真 `useInputCompletions`,只桩 `complete_notes`)。
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteTitle } from '../shared/types';
import { mountCompletions } from './completions-test-kit';
import type { CompletionsDom } from './completions-test-kit';

const { completeNotes, completeTags } = vi.hoisted(() => ({
  completeNotes: vi.fn(),
  completeTags: vi.fn(),
}));
vi.mock('../shared/api', () => ({ api: { completeNotes, completeTags, hideInputBar: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let dom: CompletionsDom;

beforeEach(async () => {
  completeNotes.mockReset();
  completeTags.mockReset();
  completeNotes.mockResolvedValue([
    { id: 1, title: '买牛奶' },
    { id: 2, title: '购物清单' },
  ] as NoteTitle[]);
  completeTags.mockResolvedValue([]);
  dom = await mountCompletions();
});
afterEach(() => {
  dom.unmount();
  vi.clearAllMocks();
});

describe('输入栏:`[[` 笔记补全', () => {
  it('打 `[[` 弹出笔记候选(标题来自 complete_notes,池只取一次)', async () => {
    await dom.type('[[牛');
    expect(completeNotes).toHaveBeenCalledTimes(1);
    expect(dom.appears('link-suggest')).toBe(true);
    expect(dom.labels('link-suggest')).toEqual(['买牛奶']);
    await dom.type('[[牛奶');
    expect(completeNotes).toHaveBeenCalledTimes(1); // 会话内缓存:不每击键打 IPC
  });

  it('空查询给整池前 8;继续打字收窄并在命中段上高亮', async () => {
    await dom.type('[');
    expect(dom.appears('link-suggest')).toBe(false); // 只一个 `[` 不算触发
    await dom.type('[[');
    expect(dom.labels('link-suggest')).toEqual(['买牛奶', '购物清单']);
    await dom.type('[[牛');
    expect(dom.labels('link-suggest')).toEqual(['买牛奶']);
    expect(dom.marks('link-suggest')).toEqual(['牛']);
  });

  it('Enter 采纳:替换 `[[查询` 为 `[[标题]]`,光标落在其后,下拉退出', async () => {
    await dom.type('[[牛');
    await dom.key('Enter');
    expect(dom.box().value).toBe('[[买牛奶]]');
    expect(dom.box().selectionStart).toBe(dom.box().value.length);
    expect(dom.appears('link-suggest')).toBe(false); // 已闭合 -> 退出补全
  });

  it('点击候选行与 Enter 同路径', async () => {
    await dom.type('[[牛');
    const row = dom.host.querySelector('[data-testid="link-suggest"] button[role="option"]') as HTMLElement;
    await act(async () => {
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(dom.box().value).toBe('[[买牛奶]]');
  });

  it('Esc 只收面板不动正文;正文再变一次(继续打字)重现', async () => {
    await dom.type('[[牛');
    await dom.key('Escape');
    expect(dom.appears('link-suggest')).toBe(false);
    expect(dom.box().value).toBe('[[牛');
    await dom.type('[[牛奶');
    expect(dom.appears('link-suggest')).toBe(true);
  });

  it('`]]` 出现即退出补全(视为已完成)', async () => {
    await dom.type('[[买牛奶]]');
    expect(dom.appears('link-suggest')).toBe(false);
  });

  it('围栏代码块里打 `[[` 不弹候选(也不取池)', async () => {
    await dom.type('```\n[[牛');
    expect(dom.appears('link-suggest')).toBe(false);
    expect(completeNotes).not.toHaveBeenCalled();
  });

  it('IME 组合中的 Enter(isComposing)不采纳;组合结束后照常采纳', async () => {
    await dom.type('[[牛');
    await dom.key('Enter', { isComposing: true });
    expect(dom.box().value).toBe('[[牛');
    expect(dom.appears('link-suggest')).toBe(true);
    await dom.key('Enter');
    expect(dom.box().value).toBe('[[买牛奶]]');
  });

  it('只给 keyCode 229 的输入法 Enter 同样不采纳(与统一输入框同口径)', async () => {
    await dom.type('[[牛');
    await dom.keyCode229('Enter');
    expect(dom.box().value).toBe('[[牛');
    expect(dom.appears('link-suggest')).toBe(true);
  });

  it('↑/↓ 移动高亮,Enter 采纳的是高亮那一行(不被光标移动的重渲染打回第一行)', async () => {
    await dom.type('[[');
    expect(dom.selected('link-suggest')).toBe(0);
    await dom.key('ArrowDown');
    expect(dom.selected('link-suggest')).toBe(1);
    await dom.key('ArrowUp');
    expect(dom.selected('link-suggest')).toBe(0);
    await dom.key('ArrowDown');
    await dom.key('Enter');
    expect(dom.box().value).toBe('[[购物清单]]');
  });
});
