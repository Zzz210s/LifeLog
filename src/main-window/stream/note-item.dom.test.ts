// @vitest-environment jsdom
/**
 * 形态 A 交互证据(jsdom 真实渲染 NoteItem):
 * 点正文就地进编辑 + 四条"不误触发"守卫(链接 / 任务复选框 / 非空选区 / chip);
 * 可见「编辑」按钮已删除,但 sr-only 键盘通道保留且可聚焦;删除按钮行为不变。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import { shouldEnterEdit } from './body-click';
import { NoteItem } from './NoteItem';

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

// react-dom 的 act 需要这个全局标记(Vitest 无内置 RTL 配置)
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (content: string, tags: string[] = []): Note => ({
  id: 1,
  content,
  created_at: '2026-09-21 08:00:00',
  tags,
});

interface Calls {
  edit: number;
  del: number;
  chips: string[];
  tasks: number[];
}

let root: Root;
let host: HTMLDivElement;
let calls: Calls;

async function mount(n: Note): Promise<void> {
  calls = { edit: 0, del: 0, chips: [], tasks: [] };
  await act(async () => {
    root.render(
      createElement(NoteItem, {
        note: n,
        activeTags: [],
        onTagClick: (t) => calls.chips.push(t),
        onEdit: () => {
          calls.edit++;
        },
        onDelete: () => {
          calls.del++;
        },
        onToggleTask: (i) => calls.tasks.push(i),
      })
    );
  });
}

/** 真实指针点击是可取消事件:必须 cancelable,否则链接/复选框的 preventDefault 不生效 */
const click = (el: Element): Promise<void> =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

const pick = (sel: string): Element => {
  const el = host.querySelector(sel);
  if (!el) throw new Error('未找到元素: ' + sel);
  return el;
};

const buttonWithText = (text: string): HTMLButtonElement => {
  const hit = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!hit) throw new Error('未找到按钮: ' + text);
  return hit;
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  openUrl.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.getSelection()?.removeAllRanges();
});

describe('shouldEnterEdit 纯判定', () => {
  it('普通元素 + 无选区 = 进编辑;非元素落点保守判否', () => {
    expect(shouldEnterEdit(document.createElement('div'), '')).toBe(true);
    expect(shouldEnterEdit(null, '')).toBe(false);
  });

  it('选区非空或落点在交互元素内(含其子节点)= 不进编辑', () => {
    const a = document.createElement('a');
    a.appendChild(document.createElement('span'));
    expect(shouldEnterEdit(a, '')).toBe(false);
    expect(shouldEnterEdit(a.firstChild, '')).toBe(false);
    expect(shouldEnterEdit(document.createElement('input'), '')).toBe(false);
    expect(shouldEnterEdit(document.createElement('button'), '')).toBe(false);
    expect(shouldEnterEdit(document.createElement('label'), '')).toBe(false);
    expect(shouldEnterEdit(document.createElement('div'), '选中的文字')).toBe(false);
  });
});

describe('NoteItem 点正文进编辑', () => {
  it('点普通正文段落 -> onEdit 一次;正文容器带 cursor-text 与 title', async () => {
    await mount(note('普通正文段落'));
    const body = pick('.md-body');
    expect(body.parentElement?.className).toContain('cursor-text');
    expect(body.parentElement?.getAttribute('title')).toBe('点击编辑');
    await click(pick('.md-body p'));
    expect(calls.edit).toBe(1);
  });

  it('守卫一:点正文里的链接不进编辑,仍走原打开逻辑', async () => {
    await mount(note('[官网](https://example.com)'));
    await click(pick('.md-body a'));
    expect(calls.edit).toBe(0);
    expect(openUrl).toHaveBeenCalledWith('https://example.com');
  });

  it('守卫二:点任务复选框不进编辑,仍回调 onToggleTask', async () => {
    await mount(note('- [ ] 一\n- [x] 二'));
    const boxes = host.querySelectorAll('.md-body input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    await click(boxes[1]);
    expect(calls.tasks).toEqual([1]);
    expect(calls.edit).toBe(0);
  });

  it('守卫三:有非空选区时点击不进编辑;清掉选区后同一点击生效', async () => {
    await mount(note('可以复制的正文'));
    const p = pick('.md-body p');
    const range = document.createRange();
    range.selectNodeContents(p);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    await click(p);
    expect(calls.edit).toBe(0);
    selection?.removeAllRanges();
    await click(p);
    expect(calls.edit).toBe(1);
  });

  it('守卫四:点标签 chip 不进编辑,仍走 onTagClick(且 chip 不在正文容器内)', async () => {
    await mount(note('正文', ['水果']));
    const chip = buttonWithText('#水果');
    expect(pick('.md-body').contains(chip)).toBe(false);
    await click(chip);
    expect(calls.chips).toEqual(['水果']);
    expect(calls.edit).toBe(0);
  });
});

describe('NoteItem 按钮:删可见编辑、留键盘通道、保删除', () => {
  it('DOM 里唯一的「编辑」按钮是 sr-only 键盘通道(可聚焦、点击可编辑)', async () => {
    await mount(note('正文'));
    const editButtons = [...host.querySelectorAll('button')].filter((b) => b.textContent === '编辑');
    expect(editButtons.length).toBe(1);
    const keyboard = editButtons[0] as HTMLButtonElement;
    expect(keyboard.classList.contains('sr-only')).toBe(true);
    expect(keyboard.classList.contains('focus:not-sr-only')).toBe(true);
    keyboard.focus();
    expect(document.activeElement).toBe(keyboard);
    await click(keyboard);
    expect(calls.edit).toBe(1);
    // 不加 role="button"(ARIA 不允许在按钮里嵌链接/复选框)
    expect(pick('.md-body').parentElement?.getAttribute('role')).toBeNull();
  });

  it('「删除」按钮保留,可见性不靠 sr-only', async () => {
    await mount(note('正文'));
    const del = buttonWithText('删除');
    expect(del.classList.contains('sr-only')).toBe(false);
    await click(del);
    expect(calls.del).toBe(1);
  });
});
