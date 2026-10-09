// @vitest-environment jsdom
/**
 * 统一输入框里 `[[` 补全的组件级证据(设计 N2–N5 的读数 1/5/6/7):
 * 触发弹候选 -> 打字收窄 -> Enter/点击采纳(文本与光标) -> Esc 只收面板 -> 围栏不弹 ->
 * 排除正在编辑的那条自己 -> IME 组合中不采纳 -> `]]` 出现即退出。
 *
 * 只桩数据层(`complete_notes`),触发/候选/键盘/采纳全走真组件。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ListRow } from '../../shared/quickpick/model';
import type { NoteTitle } from '../../shared/types';
import type { PaletteController } from '../palette/use-palette';
import { UnifiedInput } from './UnifiedInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { completeNotes, saveInputNote, listTags } = vi.hoisted(() => ({
  completeNotes: vi.fn(async (): Promise<NoteTitle[]> => [
    { id: 1, title: '买牛奶' },
    { id: 2, title: '购物清单' },
  ]),
  saveInputNote: vi.fn(async (_s: string) => 1),
  listTags: vi.fn(async () => []),
}));
vi.mock('../../shared/api', () => ({ api: { completeNotes, saveInputNote, listTags } }));

let root: Root | null = null;
const mount = async (props: Partial<Parameters<typeof UnifiedInput>[0]> = {}) => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(UnifiedInput, { onSaved: () => {}, editing: false, dataVersion: 0, ...props })));
  return host;
};
const box = (host: HTMLElement) => host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
const drop = (host: HTMLElement) => host.querySelector('[data-testid="unified-dropdown"]');
/** 当前候选行文案(顺序即展示序) */
const labels = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('[data-testid="unified-dropdown"] li[role="option"]')).map((li) => li.textContent!.trim());

/** 前缀候选控制器的桩(回归用:证明 `[[` 未命中时既有四类前缀照旧) */
const stubPalette = (over: Partial<PaletteController> = {}): PaletteController => ({
  prefix: '', query: '', rows: [], total: 0, truncated: false, activeIndex: 0,
  setQuery: () => {}, setPrefix: () => {}, setActiveIndex: () => {}, ...over,
});
const stubRow = (label: string): ListRow => ({
  item: { id: label, label }, score: 1, ranges: [], positions: [], pinned: false, mruCount: 0,
});

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};
/** 输入文本并把光标放在末尾(链接触发判断读光标) */
const type = async (host: HTMLElement, text: string) => {
  const el = box(host);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
};
const key = async (host: HTMLElement, k: string, mod: KeyboardEventInit = {}) => {
  await act(async () => {
    box(host).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...mod }));
  });
  await settle();
};

beforeEach(() => {
  completeNotes.mockClear();
  completeNotes.mockResolvedValue([
    { id: 1, title: '买牛奶' },
    { id: 2, title: '购物清单' },
  ]);
  saveInputNote.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('统一输入框:`[[` 笔记补全', () => {
  it('打 `[[` 弹出笔记候选(标题来自 complete_notes)', async () => {
    const host = await mount();
    await type(host, '[[牛');
    expect(completeNotes).toHaveBeenCalledTimes(1);
    expect(drop(host)).not.toBeNull();
    expect(labels(host)).toEqual(['买牛奶']);
  });

  it('空查询给整池前 8;继续打字收窄并在命中段上高亮', async () => {
    const host = await mount();
    await type(host, '[[');
    expect(labels(host)).toEqual(['买牛奶', '购物清单']);
    await type(host, '[[牛');
    expect(labels(host)).toEqual(['买牛奶']);
    expect(host.querySelector('mark')?.textContent).toBe('牛');
  });

  it('Enter 采纳:替换 `[[查询` 为 `[[标题]]`,光标落在其后,且不存笔记', async () => {
    const host = await mount();
    await type(host, '[[牛');
    await key(host, 'Enter');
    expect(box(host).value).toBe('[[买牛奶]]');
    expect(box(host).selectionStart).toBe(box(host).value.length);
    expect(drop(host)).toBeNull(); // 已闭合 -> 退出补全
    expect(saveInputNote).not.toHaveBeenCalled();
  });

  it('点击候选行与 Enter 同路径', async () => {
    const host = await mount();
    await type(host, '[[牛');
    await act(async () => (host.querySelector('li[role="option"]') as HTMLElement).click());
    expect(box(host).value).toBe('[[买牛奶]]');
  });

  it('Esc 只收面板不动正文;正文再变一次(继续打字)重现', async () => {
    const host = await mount();
    await type(host, '[[牛');
    await key(host, 'Escape');
    expect(drop(host)).toBeNull();
    expect(box(host).value).toBe('[[牛');
    await type(host, '[[牛奶');
    expect(drop(host)).not.toBeNull();
  });

  it('`]]` 出现即退出补全(视为已完成)', async () => {
    const host = await mount();
    await type(host, '[[买牛奶]]');
    expect(drop(host)).toBeNull();
  });

  it('围栏代码块里打 `[[` 不弹候选(也不取池)', async () => {
    const host = await mount();
    await type(host, '```\n[[牛');
    expect(drop(host)).toBeNull();
    expect(completeNotes).not.toHaveBeenCalled();
  });

  it('候选不含正在编辑的那一条自己(excludeNoteId)', async () => {
    const host = await mount({ excludeNoteId: 2 });
    await type(host, '[[');
    expect(labels(host)).toEqual(['买牛奶']);
  });

  it('IME 组合中的 Enter 不采纳、不关面板;组合结束后照常采纳', async () => {
    const host = await mount();
    await type(host, '[[牛');
    await key(host, 'Enter', { isComposing: true });
    expect(box(host).value).toBe('[[牛');
    expect(drop(host)).not.toBeNull();
    await key(host, 'Enter');
    expect(box(host).value).toBe('[[买牛奶]]');
  });

  it('↑/↓ 在笔记候选里循环移动高亮(与 `#` 补全同一套键盘)', async () => {
    const host = await mount();
    await type(host, '[[');
    const selected = () =>
      Array.from(host.querySelectorAll('[data-testid="unified-dropdown"] li[role="option"]'))
        .findIndex((li) => li.getAttribute('aria-selected') === 'true');
    expect(selected()).toBe(0);
    await key(host, 'ArrowDown');
    expect(selected()).toBe(1);
    await key(host, 'ArrowUp');
    expect(selected()).toBe(0);
    await key(host, 'ArrowUp'); // 首行再上一位 = 末行(循环取模)
    expect(selected()).toBe(1);
  });

  it('未命中 `[[` 时原前缀行为完全不变:记录模式无下拉,`#` 仍走既有候选池', async () => {
    const plain = await mount();
    await type(plain, '买牛奶');
    expect(drop(plain)).toBeNull();

    // `#` 的候选来自宿主给的控制器(既有 provider),笔记池一次都不取
    const host = await mount({ candidates: { palette: stubPalette({ rows: [stubRow('标签甲')], total: 1 }) } });
    await type(host, '#购');
    expect(drop(host)).not.toBeNull();
    expect(labels(host)).toEqual(['标签甲']);
    expect(completeNotes).not.toHaveBeenCalled();
  });
});
