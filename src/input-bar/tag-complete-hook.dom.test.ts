/**
 * 输入栏 `#` 补全的接线测试(T8):空词元三档、有词元纯按分(固定项不插队)、
 * 乱序回包丢弃、采纳作废在途、Esc 只关列表、采纳写标签 MRU(ui.mru.tags)。
 * 夹具是真实 textarea + 真 hook,只有 IPC(completeTags)走 mock。
 */
// @vitest-environment jsdom
import { act, createElement, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMru } from '../shared/quickpick/mru';
import type { MruStorage } from '../shared/quickpick/mru';
import type { CompleteItem } from '../shared/types';
import { useTagComplete } from './use-tag-complete';
import type { TagCompleteState } from './use-tag-complete';

const { completeTags, hideInputBar } = vi.hoisted(() => ({
  completeTags: vi.fn(),
  hideInputBar: vi.fn(),
}));
vi.mock('../shared/api', () => ({ api: { completeTags, hideInputBar } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tag = (path: string): CompleteItem => ({ path, kind: 'tag' });

let host: HTMLDivElement;
let root: Root;
let latest: TagCompleteState;
let onReplace: ReturnType<typeof vi.fn>;
let storage: MruStorage & { text: string | null };
let settings: { pinnedTags: string[]; mruTags: ReturnType<typeof createMru> };

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  completeTags.mockReset();
  hideInputBar.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

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
    settings,
    onMruChange: () => settings.mruTags.save(),
  });
  return createElement('textarea', { ref, defaultValue: '' });
}

async function mountHarness(pinned: string[] = [], mruIds: string[] = []): Promise<HTMLTextAreaElement> {
  storage = {
    text: null,
    read: () => storage.text,
    write: (t: string) => {
      storage.text = t;
    },
  };
  settings = { pinnedTags: pinned, mruTags: createMru({ storage }) };
  for (const id of mruIds) settings.mruTags.touch(id);
  onReplace = vi.fn();
  await act(async () => {
    root.render(createElement(Harness));
  });
  const el = host.querySelector('textarea');
  if (el === null) throw new Error('textarea 没渲染');
  return el as HTMLTextAreaElement;
}

/** 模拟键入:改 DOM 值 + 光标 + 派发 input(输入栏是非受控 textarea) */
async function type(el: HTMLTextAreaElement, text: string): Promise<void> {
  await act(async () => {
    el.value = text;
    el.selectionStart = text.length;
    el.selectionEnd = text.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const keyEvent = (key: string) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  nativeEvent: { isComposing: false },
});

const paths = (): string[] => latest.items.map((r) => r.path);

describe('useTagComplete:三档 / 排序 / 在途取消', () => {
  it('空词元三档:固定项 -> 最近用过 -> 全量(按路径序)', async () => {
    completeTags.mockResolvedValue([tag('甲'), tag('乙'), tag('丙')]);
    const el = await mountHarness(['丙'], ['乙']);
    await type(el, '#');
    expect(paths()).toEqual(['丙', '乙', '甲']);
    expect(latest.items.map((r) => r.pinned)).toEqual([true, false, false]);
  });

  it('有词元纯按分排序,固定项不插队', async () => {
    completeTags.mockResolvedValue([tag('项目'), tag('工作/项目A')]);
    const el = await mountHarness(['工作/项目A']);
    await type(el, '#项目');
    expect(paths()).toEqual(['项目', '工作/项目A']);
    expect(latest.items[1].pinned).toBe(true);
  });

  it('乱序回包丢弃:先发后回的旧响应不得覆盖新列表', async () => {
    const resolvers: Array<(v: CompleteItem[]) => void> = [];
    completeTags.mockImplementation(() => new Promise<CompleteItem[]>((res) => resolvers.push(res)));
    const el = await mountHarness();
    await type(el, '#项A'); // 第 1 次请求
    await type(el, '#项'); // 第 2 次请求
    expect(completeTags.mock.calls.map((c) => c[0])).toEqual(['项A', '项']);
    await act(async () => resolvers[1]([tag('项目'), tag('工作/项目A')])); // 第 2 次先回
    expect(paths()).toEqual(['项目', '工作/项目A']);
    await act(async () => resolvers[0]([tag('工作/项目A')])); // 第 1 次后回:必须丢弃
    expect(paths()).toEqual(['项目', '工作/项目A']);
  });

  it('采纳作废在途:Enter 采纳后,同词元的回包不得把列表弹回来', async () => {
    let resolve: (v: CompleteItem[]) => void = () => undefined;
    completeTags
      .mockResolvedValueOnce([tag('工作/项目A')])
      .mockImplementationOnce(() => new Promise<CompleteItem[]>((res) => { resolve = res; }));
    const el = await mountHarness();
    await type(el, '#项'); // 第 1 次请求已回:列表里有候选
    expect(paths()).toEqual(['工作/项目A']);
    await type(el, '#项A'); // 第 2 次请求在途(采纳后它的回包必须被丢弃)
    const enter = keyEvent('Enter');
    act(() => {
      expect(latest.onKeyDown(enter as never)).toBe(true);
    });
    expect(onReplace).toHaveBeenCalledWith('#工作/项目A ');
    expect(paths()).toEqual([]);
    await act(async () => resolve([tag('工作/项目A')]));
    expect(paths()).toEqual([]);
  });

  it('Esc 只关列表(消费按键 + 阻断冒泡),同一词元的 keyup 不再弹回,换词元重新弹', async () => {
    completeTags.mockResolvedValue([tag('工作/项目A')]);
    const el = await mountHarness();
    await type(el, '#项A');
    expect(paths()).toEqual(['工作/项目A']);
    const esc = keyEvent('Escape');
    act(() => {
      expect(latest.onKeyDown(esc as never)).toBe(true);
    });
    expect(esc.preventDefault).toHaveBeenCalled();
    expect(esc.stopPropagation).toHaveBeenCalled(); // 窗口级 Esc 隐藏输入栏收不到
    expect(hideInputBar).not.toHaveBeenCalled();
    expect(paths()).toEqual([]);
    await act(async () => {
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    });
    expect(paths()).toEqual([]); // 同一词元不弹回
    await type(el, '#项目');
    expect(paths()).toEqual(['工作/项目A']);
  });

  it('采纳把路径写进标签 MRU(ui.mru.tags)并落盘', async () => {
    completeTags.mockResolvedValue([tag('工作/项目A')]);
    const el = await mountHarness([], []);
    await type(el, '#项A');
    act(() => {
      latest.onPick('工作/项目A');
    });
    expect(settings.mruTags.entries()).toEqual([{ id: '工作/项目A', count: 1 }]);
    expect(storage.text).toBe('[{"id":"工作/项目A","count":1}]');
  });

});
