// @vitest-environment jsdom
/**
 * 输入栏的取值侧组合守卫(用户报告 2026-10-15):`#` 标签候选在拼音未上屏时不该被驱动 ——
 * 老实现里元素级 `input` 监听直接读 DOM,组合中的原始拼音已经发出去 completeTags 一趟。
 * 夹具见 `completions-test-kit.ts`(真 textarea + 真两套 hook,只有 IPC 走 mock)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompleteItem } from '../shared/types';
import { mountCompletions } from './completions-test-kit';
import type { CompletionsDom } from './completions-test-kit';

const { completeTags } = vi.hoisted(() => ({ completeTags: vi.fn() }));
vi.mock('../shared/api', () => ({ api: { completeTags, completeNotes: vi.fn(), listTags: vi.fn(), hideInputBar: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let dom: CompletionsDom;

beforeEach(async () => {
  completeTags.mockReset();
  completeTags.mockResolvedValue([{ path: '标签甲', kind: 'tag' }] as CompleteItem[]);
  dom = await mountCompletions();
});
afterEach(() => {
  dom.unmount();
  vi.clearAllMocks();
});

describe('输入栏:`#` 候选不被组合中的原始拼音驱动', () => {
  it('组合中一次 IPC 都不发,下拉保持组合前那一版;上屏后才按最终词再取一次', async () => {
    await dom.type('#标');
    expect(completeTags).toHaveBeenCalledTimes(1);
    expect(completeTags).toHaveBeenLastCalledWith('标');
    expect(dom.appears('tag-suggest')).toBe(true);

    await dom.compose('#标chen');
    expect(dom.box().value).toBe('#标chen'); // 拼音照样在框里(取值不被丢弃)
    expect(completeTags).toHaveBeenCalledTimes(1); // 组合中不发 IPC

    await dom.compose('#标chengping');
    expect(completeTags).toHaveBeenCalledTimes(1);
    expect(dom.appears('tag-suggest')).toBe(true); // 下拉保持组合前那一版

    await dom.commit('#标签');
    expect(completeTags).toHaveBeenCalledTimes(2); // 上屏后恰好一次
    expect(completeTags).toHaveBeenLastCalledWith('标签');
  });
});
