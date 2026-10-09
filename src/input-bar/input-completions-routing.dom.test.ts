// @vitest-environment jsdom
/**
 * 输入栏两套补全的**互斥与不互相污染**(设计 N3 的 ⑤):`[[` 命中时用笔记候选,否则 `#`
 * 标签候选照旧 —— 渲染与键盘只走一套,另一套的候选池一次都不取。
 * 夹具见 `completions-test-kit.ts`;单独成文件让「路由」有独立的失败面。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompleteItem, NoteTitle } from '../shared/types';
import { mountCompletions } from './completions-test-kit';
import type { CompletionsDom } from './completions-test-kit';

const { completeNotes, completeTags, listTags } = vi.hoisted(() => ({
  completeNotes: vi.fn(),
  completeTags: vi.fn(),
  listTags: vi.fn(),
}));
vi.mock('../shared/api', () => ({ api: { completeNotes, completeTags, listTags, hideInputBar: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let dom: CompletionsDom;

beforeEach(async () => {
  completeNotes.mockReset();
  listTags.mockReset();
  listTags.mockResolvedValue([]);
  completeTags.mockReset();
  completeNotes.mockResolvedValue([{ id: 1, title: '买牛奶' }] as NoteTitle[]);
  completeTags.mockResolvedValue([{ path: '标签甲', kind: 'tag' }] as CompleteItem[]);
  dom = await mountCompletions();
});
afterEach(() => {
  dom.unmount();
  vi.clearAllMocks();
});

describe('输入栏:`[[` 与 `#` 两套补全互斥', () => {
  it('`#` 照旧走标签候选:`[[` 的笔记池一次都不取', async () => {
    await dom.type('#标');
    expect(dom.appears('tag-suggest')).toBe(true);
    expect(dom.appears('link-suggest')).toBe(false);
    expect(completeNotes).not.toHaveBeenCalled();
  });

  it('`[[` 命中即用笔记候选:标签候选不渲染', async () => {
    await dom.type('#标');
    await dom.type('[[牛');
    expect(dom.appears('link-suggest')).toBe(true);
    expect(dom.appears('tag-suggest')).toBe(false);
    expect(completeNotes).toHaveBeenCalledTimes(1);
  });

  it('Esc 收起链接面板后,标签补全仍独立可用(状态互不污染)', async () => {
    await dom.type('[[牛');
    expect(dom.appears('link-suggest')).toBe(true);
    await dom.key('Escape');
    expect(dom.appears('link-suggest')).toBe(false);
    expect(dom.box().value).toBe('[[牛'); // 只收面板
    await dom.type('#标');
    expect(dom.appears('tag-suggest')).toBe(true);
    expect(dom.appears('link-suggest')).toBe(false);
  });
});
