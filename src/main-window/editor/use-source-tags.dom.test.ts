// @vitest-environment jsdom
/**
 * useSourceTagCount 的行为验证(jsdom 渲染真实组件):
 * 250ms 防抖、过期响应丢弃(连打/换源)、失败回退已保存标签数(不闪烁成 0)。
 * 这是编辑面板实时标签数的"防抖与竞态"证据;显示口径另见 source-tags.test.ts。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSourceTagCount } from './use-source-tags';

const { parseNoteSource } = vi.hoisted(() => ({ parseNoteSource: vi.fn() }));
vi.mock('../../shared/api', () => ({ api: { parseNoteSource } }));

interface Deferred {
  resolve: (v: { content: string; tags: string[] }) => void;
  reject: (e: unknown) => void;
}

const defer = (): Deferred => {
  let resolve!: Deferred['resolve'];
  let reject!: Deferred['reject'];
  const p = new Promise<{ content: string; tags: string[] }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  parseNoteSource.mockReturnValueOnce(p);
  return { resolve, reject };
};

function Harness({ source, saved }: { source: string; saved: number }) {
  return createElement('span', null, String(useSourceTagCount(source, saved)));
}

let root: Root;
let host: HTMLDivElement;
const text = (): string => host.textContent ?? '';

const render = async (source: string, saved: number): Promise<void> => {
  await act(async () => {
    root.render(createElement(Harness, { source, saved }));
  });
};

const tick = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  parseNoteSource.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('useSourceTagCount(防抖 + 竞态)', () => {
  it('250ms 内不发请求,到点后调 parse_note_source 并显示解析出的标签数', async () => {
    const d = defer();
    await render('#a #b', 5);
    expect(text()).toBe('5'); // 尚未返回:回退已保存数,不闪烁成 0
    await tick(200);
    expect(parseNoteSource).not.toHaveBeenCalled();
    await tick(50);
    expect(parseNoteSource).toHaveBeenCalledWith('#a #b');
    await act(async () => d.resolve({ content: '', tags: ['a', 'b'] }));
    expect(text()).toBe('2');
  });

  it('解析失败时回退已保存标签数', async () => {
    const d = defer();
    await render('正文 #x', 4);
    await tick(250);
    await act(async () => d.reject(new Error('IPC 失败')));
    expect(text()).toBe('4');
  });

  it('连打/换源:过期响应一律丢弃,只采纳最新一次', async () => {
    const first = defer();
    await render('#a', 7);
    await tick(250); // 第一次请求在途
    const second = defer();
    await render('#a #b #c', 7); // 源码已变:第一次作废
    await tick(250);
    expect(parseNoteSource).toHaveBeenNthCalledWith(2, '#a #b #c');
    await act(async () => second.resolve({ content: '', tags: ['a', 'b', 'c'] }));
    expect(text()).toBe('3');
    await act(async () => first.resolve({ content: '', tags: ['a'] })); // 迟到:必须被丢弃
    expect(text()).toBe('3');
  });
});
