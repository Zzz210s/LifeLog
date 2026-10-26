// @vitest-environment jsdom
/**
 * 顶栏多库切换(2026-10-26):列表渲染、切库调 `switchLibrary` 并触发重载、错误就地显示。
 * 夹具只 mock `api`,不碰 Tauri。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const libs = {
  current: 'richang',
  libraries: [
    { id: 'richang', name: '日常', dir: 'libraries/richang', createdAt: '20260101T000000' },
    { id: 'lib-2', name: '写作', dir: 'libraries/lib-2', createdAt: '20260102T000000' },
  ],
};

vi.mock('../../shared/api', () => ({
  api: {
    listLibraries: () => Promise.resolve(libs),
    switchLibrary: (id: string) => {
      calls.push('switch:' + id);
      return Promise.resolve(libs);
    },
    createLibrary: (name: string) => {
      calls.push('create:' + name);
      return Promise.resolve(libs.libraries[0]);
    },
    renameLibrary: (id: string, name: string) => {
      calls.push('rename:' + id + ':' + name);
      return Promise.resolve(libs);
    },
    deleteLibrary: (id: string) => {
      calls.push('delete:' + id);
      return Promise.resolve(libs);
    },
  },
}));

const { LibrarySwitch } = await import('./LibrarySwitch');

let host: HTMLDivElement;
let root: Root | null = null;

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  calls.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  root = null;
});

const mount = async (onSwitched = () => {}): Promise<void> => {
  act(() => root!.render(createElement(LibrarySwitch, { onSwitched })));
  await flush();
};

const btn = (attr: string, value: string): HTMLElement | null =>
  host.querySelector(`[${attr}="${value}"]`) as HTMLElement | null;

describe('顶栏多库切换', () => {
  it('显示「拾枝 · 当前库名」', async () => {
    await mount();
    expect(btn('data-testid', 'library-switch')?.textContent).toContain('拾枝');
    expect(btn('data-testid', 'library-switch')?.textContent).toContain('日常');
  });

  it('点开列出全部库,当前库带 aria-checked', async () => {
    await mount();
    act(() => btn('data-testid', 'library-switch')!.click());
    const items = [...host.querySelectorAll('[role="menuitemradio"]')];
    expect(items.map((e) => e.textContent)).toEqual(['日常当前', '写作']);
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    expect(items[1].getAttribute('aria-checked')).toBe('false');
  });

  it('切到另一个库:调 switchLibrary 并触发重载回调', async () => {
    const switched: string[] = [];
    await mount(() => switched.push('reload'));
    act(() => btn('data-testid', 'library-switch')!.click());
    act(() => (host.querySelectorAll('[role="menuitemradio"]')[1] as HTMLElement).click());
    await flush();
    expect(calls).toContain('switch:lib-2');
    expect(switched).toEqual(['reload']);
  });

  it('点当前库不切(不重复换连接)', async () => {
    await mount();
    act(() => btn('data-testid', 'library-switch')!.click());
    act(() => (host.querySelectorAll('[role="menuitemradio"]')[0] as HTMLElement).click());
    await flush();
    expect(calls).toEqual([]);
  });

  it('新建库:输入名字后回车提交', async () => {
    await mount();
    act(() => btn('data-testid', 'library-switch')!.click());
    const create = [...host.querySelectorAll('[role="menuitem"]')].find((e) =>
      (e.textContent ?? '').includes('新建库')
    ) as HTMLElement;
    act(() => create.click());
    const input = host.querySelector('[data-testid="library-name-pane"] input') as HTMLInputElement;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, '写作');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush();
    expect(calls).toContain('create:写作');
  });
});
