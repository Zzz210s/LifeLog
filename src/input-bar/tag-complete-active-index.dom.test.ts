/**
 * 输入栏 `#` 补全的**高亮位置**接线测试(实测 bug 2026-09-26:"上下箭头选不动")。
 *
 * 根因:↓/↑ 的 keyup 会触发重算,回包里的"新候选归零高亮"把刚移动的高亮打回第一行。
 * 现在列表的写入口(`useCandidateList.setList`)在候选没变时原地不动 —— 这两条钉住它。
 *
 * 夹具与 `tag-complete-hook.dom.test.ts` 同款(真 textarea + 真 hook,只 mock IPC),
 * 单独成文件是为了守住 200 行红线。
 */
// @vitest-environment jsdom
import { act, createElement, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompleteItem } from '../shared/types';
import { useTagComplete } from './use-tag-complete';
import type { TagCompleteState } from './use-tag-complete';

const { completeTags } = vi.hoisted(() => ({ completeTags: vi.fn() }));
vi.mock('../shared/api', () => ({ api: { completeTags, hideInputBar: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tag = (path: string): CompleteItem => ({ path, kind: 'tag' });
const keyEvent = (key: string) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  nativeEvent: { isComposing: false },
});

let host: HTMLDivElement;
let root: Root;
let latest: TagCompleteState;
let onReplace: ReturnType<typeof vi.fn>;

function Harness(): ReactNode {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  latest = useTagComplete({
    textareaRef: ref,
    value,
    onReplace: (next: string) => {
      onReplace(next);
      setValue(next);
    },
  });
  return createElement('textarea', { ref, defaultValue: '' });
}

beforeEach(() => {
  completeTags.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onReplace = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** 挂载并键入一个词元(输入栏是非受控 textarea:改值 + 光标 + 派发 input) */
async function mountAndType(text: string): Promise<HTMLTextAreaElement> {
  await act(async () => {
    root.render(createElement(Harness));
  });
  const el = host.querySelector('textarea');
  if (el === null) throw new Error('textarea 没渲染');
  await act(async () => {
    el.value = text;
    el.selectionStart = text.length;
    el.selectionEnd = text.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return el as HTMLTextAreaElement;
}

const paths = (): string[] => latest.items.map((r) => r.path);

describe('useTagComplete:高亮位置不被重算打回第一行', () => {
  it('↑/↓ 移动高亮后,keyup 触发的重算**不得**把高亮打回第一行(实测 bug:2026-09-26)', async () => {
    completeTags.mockResolvedValue([tag('书籍'), tag('书籍/历史'), tag('书籍/SQL')]);
    const el = await mountAndType('#书');
    expect(latest.activeIndex).toBe(0);
    // ↓:keydown 消费 + keyup(真实按键顺序)。keyup 会触发重算,回包与当前列表**完全相同**
    await act(async () => {
      latest.onKeyDown(keyEvent('ArrowDown') as never);
    });
    expect(latest.activeIndex).toBe(1);
    await act(async () => {
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
      await Promise.resolve();
    });
    expect(latest.activeIndex).toBe(1); // 修复前这里是 0(高亮被打回第一行)

    // 另一条重算路径:点击换位(光标没动、候选与上一批**完全相同**)——同样不得归零
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(latest.activeIndex).toBe(1);

    // 再按一次 ↓ 到第二行,Enter 采纳的必须是**高亮那一行**而不是第一行
    await act(async () => {
      latest.onKeyDown(keyEvent('ArrowDown') as never);
    });
    expect(latest.activeIndex).toBe(2);
    await act(async () => {
      latest.onKeyDown(keyEvent('Enter') as never);
    });
    expect(onReplace).toHaveBeenLastCalledWith('#书籍/SQL ');
  });

  it('候选列表真的变了才把高亮归零(换词元/新一批候选)', async () => {
    completeTags.mockResolvedValue([tag('书籍'), tag('书籍/历史'), tag('书籍/SQL')]);
    const el = await mountAndType('#书');
    await act(async () => {
      latest.onKeyDown(keyEvent('ArrowDown') as never);
    });
    expect(latest.activeIndex).toBe(1);
    // 换词元 -> 新一批候选(与上一批不同)-> 归零
    completeTags.mockResolvedValue([tag('电影'), tag('电影院')]);
    await act(async () => {
      el.value = '#电';
      el.selectionStart = 2;
      el.selectionEnd = 2;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(paths()).toEqual(['电影', '电影院']);
    expect(latest.activeIndex).toBe(0);
  });
});
