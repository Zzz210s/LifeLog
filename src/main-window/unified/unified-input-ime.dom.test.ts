// @vitest-environment jsdom
/**
 * 输入法组合守卫的接线证据(审查 C1):中文候选下拉开着时,上屏那一下的 Enter 不能当成
 * 「采纳当前行」(会误加筛选条件/误滚到笔记/误跑命令)。
 * 守卫写在 routeUnifiedKey 里,但只有派发真实 keydown(React 把 nativeEvent.isComposing
 * 交给路由)才算把接线钉住,故这里挂真组件 + 浮层控制器桩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UnifiedInput } from './UnifiedInput';
import type { PaletteController } from '../palette/use-palette';
import type { ListRow } from '../../shared/quickpick/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const saveInputNote = vi.fn(async (_s: string) => 1);
vi.mock('../../shared/api', () => ({ api: { saveInputNote: (s: string) => saveInputNote(s) } }));

let root: Root | null = null;
const mount = async (props: Partial<Parameters<typeof UnifiedInput>[0]> = {}) => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(UnifiedInput, { onSaved: () => {}, editing: false, ...props })));
  return host;
};
const box = (host: HTMLElement) => host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
const type = async (host: HTMLElement, text: string) => {
  const el = box(host);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const key = async (host: HTMLElement, k: string, mod: KeyboardEventInit = {}) => {
  await act(async () => {
    box(host).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...mod }));
  });
};

const rows = (n: number): ListRow[] => // 候选行:列表模型的形状
  Array.from({ length: n }, (_, i) => ({
    item: { id: `t${i}`, label: `标签${i}` },
    score: 1,
    ranges: [],
    positions: [],
    pinned: false,
    mruCount: 0,
  }));

const stubPalette = (over: Partial<PaletteController> = {}): PaletteController => ({
  isOpen: false, prefix: '', query: '', rows: [], total: 0, truncated: false, activeIndex: 0,
  inputRef: { current: null }, open: () => {}, close: () => {}, setQuery: () => {}, setPrefix: () => {},
  setActiveIndex: () => {}, accept: () => {}, handleKeyDown: () => {}, ...over,
});

const drop = (host: HTMLElement) => host.querySelector('[data-testid="unified-dropdown"]');

beforeEach(() => saveInputNote.mockClear());
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('唯一输入框:输入法组合守卫(审查 C1)', () => {
  it('# 模式组合中的 Enter 不采纳:下拉仍开、内容不变、onAccept 未被调用', async () => {
    const onAccept = vi.fn();
    const host = await mount({ candidates: { palette: stubPalette({ rows: rows(2), total: 2 }) }, onAccept });
    await type(host, '#UI测试');
    expect(drop(host)!.querySelectorAll('li[role="option"]').length).toBe(2);

    await key(host, 'Enter', { isComposing: true }); // 上屏那一下
    expect(onAccept).not.toHaveBeenCalled();
    expect(drop(host)).not.toBeNull();
    expect(box(host).value).toBe('#UI测试');

    await key(host, 'Enter'); // 组合结束后的正常 Enter 必须照旧采纳(守卫没挡住正常路径)
    expect(onAccept).toHaveBeenCalledWith(0);
    expect(drop(host)).toBeNull();
  });

  it('# 模式组合中的 Tab 与 Ctrl+Enter 都不生效,组合结束后才生效', async () => {
    const onAccept = vi.fn();
    const host = await mount({ candidates: { palette: stubPalette({ rows: rows(2), total: 2 }) }, onAccept });
    await type(host, '#UI测试');
    await key(host, 'Tab', { isComposing: true });
    expect(onAccept).not.toHaveBeenCalled();
    await key(host, 'Enter', { ctrlKey: true, isComposing: true });
    expect(saveInputNote).not.toHaveBeenCalled();

    await key(host, 'Enter', { ctrlKey: true });
    expect(saveInputNote).toHaveBeenCalledWith('#UI测试');
  });
});
