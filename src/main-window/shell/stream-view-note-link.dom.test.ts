// @vitest-environment jsdom
/**
 * L2 组件级证据:正文里 `[[X]]` chip 的两种点击落地(读数 2 / 读数 4 的机制侧)。
 * 装配复用 `__fixtures__/stream-view-harness.ts`(与采纳用例同一套),这里只钉点击分发:
 * 已解析 -> 复用快速打开(滚动 + 高亮),未解析 -> 统一输入框预填 `@原文`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { Note } from '../../shared/types';
import { installGeometryStubs, mountStreamView } from './__fixtures__/stream-view-harness';

const { getSetting, setSetting, saveInputNote } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  setSetting: vi.fn(async (_key: string, _value: string) => {}),
  saveInputNote: vi.fn(async (_s: string) => 1),
}));
vi.mock('../../shared/api', () => ({ api: { getSetting, setSetting, saveInputNote } }));

const TARGET: Note = {
  id: 3, content: 'UI测试笔记', created_at: '2026-09-24 10:00:00', tags: [], links: [],
};
const SOURCE: Note = {
  id: 4, content: '源 [[UI测试笔记]] 又 [[没有的笔记]]', created_at: '2026-09-24 10:00:01', tags: [],
  links: [
    { rawTitle: 'UI测试笔记', targetId: 3, title: 'UI测试笔记' },
    { rawTitle: '没有的笔记', targetId: null, title: null },
  ],
};

const ALIAS: Note = {
  id: 5, content: '看 [[UI测试笔记|我自己的说法]] 与 [[没有的笔记|随便什么]]',
  created_at: '2026-09-24 10:00:02', tags: [],
  links: [
    { rawTitle: 'UI测试笔记', targetId: 3, title: 'UI测试笔记' },
    { rawTitle: '没有的笔记', targetId: null, title: null },
  ],
};

let scrollSpy: ReturnType<typeof vi.fn>;

const click = async (el: Element): Promise<void> => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

beforeEach(() => {
  scrollSpy = vi.fn();
  installGeometryStubs();
  Element.prototype.scrollIntoView = scrollSpy as unknown as Element['scrollIntoView'];
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('正文 chip 点击(StreamView 执行)', () => {
  it('已解析 chip -> 复用快速打开:滚到目标笔记并临时高亮', async () => {
    const m = await mountStreamView({ notes: [SOURCE, TARGET] });
    const chip = m.host.querySelector('[data-note-link="3"]');
    expect(chip).not.toBeNull();
    expect(chip!.className).toContain('text-accent');
    await click(chip!);
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'center' });
    const row = m.host.querySelector('[data-note-body="3"]')!.closest('li')!;
    expect(row.className).toContain('bg-accent-soft');
    m.unmount();
  });

  it('未解析 chip -> 统一输入框预填 `@` + 原文', async () => {
    const m = await mountStreamView({ notes: [SOURCE, TARGET] });
    const chip = m.host.querySelector('[data-note-link=""]');
    expect(chip).not.toBeNull();
    expect(chip!.className).toContain('decoration-dashed');
    await click(chip!);
    const box = m.host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
    expect(box.value).toBe('@没有的笔记');
    m.unmount();
  });
});

describe('正文 chip 别名(设计 A5)', () => {
  it('已解析:chip 文字=显示文本,title=目标标题,点击跳的是目标', async () => {
    const m = await mountStreamView({ notes: [ALIAS, TARGET] });
    const chip = m.host.querySelector('[data-note-link="3"]') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('我自己的说法');
    expect(chip.getAttribute('title')).toBe('UI测试笔记');
    expect(chip.getAttribute('data-note-link-raw')).toBe('UI测试笔记');
    await click(chip);
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'center' });
    const row = m.host.querySelector('[data-note-body="3"]')!.closest('li')!;
    expect(row.className).toContain('bg-accent-soft');
    m.unmount();
  });

  it('未解析:chip 文字=显示文本,点击预填的是**目标**不是显示文本', async () => {
    const m = await mountStreamView({ notes: [ALIAS, TARGET] });
    const chip = m.host.querySelector('[data-note-link=""]') as HTMLElement;
    expect(chip.textContent).toBe('随便什么');
    expect(chip.getAttribute('title')).toBe('没有的笔记');
    await click(chip);
    const box = m.host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
    expect(box.value).toBe('@没有的笔记');
    m.unmount();
  });
});
