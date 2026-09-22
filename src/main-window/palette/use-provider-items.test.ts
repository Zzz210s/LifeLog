/**
 * 候选取回的单测:前缀剥掉后交给 provider、旧回包丢弃(乱序)、失败不静默成空列表。
 */
// @vitest-environment jsdom
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProviderRegistry } from '../../shared/quickpick/providers';
import type { QuickPickItem } from '../../shared/quickpick/model';
import { loadProviderItems, useProviderItems } from './use-provider-items';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (id: string): QuickPickItem => ({ id, label: id });

describe('loadProviderItems:解析与过期判定', () => {
  it('前缀剥掉后交给对应 provider(空前缀给默认 provider)', async () => {
    const reg = createProviderRegistry();
    const notes = vi.fn(() => [item('n')]);
    const cmds = vi.fn(() => [item('c')]);
    reg.register({ prefix: '', id: 'notes', getItems: notes });
    reg.register({ prefix: '>', id: 'commands', getItems: cmds });

    expect(await loadProviderItems(reg, '>abc', () => false)).toEqual([item('c')]);
    expect(cmds).toHaveBeenCalledWith('abc');
    expect(await loadProviderItems(reg, 'abc', () => false)).toEqual([item('n')]);
    expect(notes).toHaveBeenCalledWith('abc');
  });

  it('过期回包给 null(调用方据此丢弃);注册表为空给空列表', async () => {
    const reg = createProviderRegistry();
    reg.register({ prefix: '', id: 'notes', getItems: () => [item('n')] });
    expect(await loadProviderItems(reg, 'x', () => true)).toBeNull();
    expect(await loadProviderItems(createProviderRegistry(), 'x', () => false)).toEqual([]);
  });

  it('provider 抛错原样向上(不静默)', async () => {
    const reg = createProviderRegistry();
    reg.register({
      prefix: '',
      id: 'notes',
      getItems: () => {
        throw new Error('候选取不到');
      },
    });
    await expect(loadProviderItems(reg, 'x', () => false)).rejects.toThrow(/候选取不到/);
  });
});

describe('useProviderItems:乱序回包丢弃', () => {
  const hosts: Array<() => void> = [];
  afterEach(() => {
    while (hosts.length > 0) hosts.pop()!();
    document.body.innerHTML = '';
  });

  it('先发后回:最终列表来自最后一次请求', async () => {
    const reg = createProviderRegistry();
    const gates: Array<(v: QuickPickItem[]) => void> = [];
    reg.register({
      prefix: '',
      id: 'notes',
      getItems: (q: string) =>
        new Promise<QuickPickItem[]>((resolve) => {
          gates.push(resolve);
          void q;
        }),
    });
    const errors: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const box: { items: readonly QuickPickItem[] } = { items: [] };
    const state = { prefix: '', query: 'a' };
    const build = (): ReactNode => {
      box.items = useProviderItems({
        registry: reg,
        isOpen: true,
        prefix: state.prefix,
        query: state.query,
        onError: (m) => errors.push(m),
      });
      return null;
    };
    await act(async () => root.render(createElement(build)));
    // 第二次请求(旧请求仍在飞)
    state.query = 'ab';
    await act(async () => root.render(createElement(build)));
    expect(gates).toHaveLength(2);

    gates[1]([item('new')]); // 新请求先回
    await act(async () => {
      await Promise.resolve();
    });
    gates[0]([item('old')]); // 旧请求后回 -> 必须被丢弃
    await act(async () => {
      await Promise.resolve();
    });
    expect(box.items).toEqual([item('new')]);
    expect(errors).toEqual([]);

    hosts.push(() => {
      act(() => root.unmount());
      host.remove();
    });
  });
});

describe('useProviderItems:候选数据源的作废键(refreshKey)', () => {
  it('registry 身份不变时:refreshKey 不变不重跑,变化即重跑', async () => {
    const reg = createProviderRegistry();
    const getItems = vi.fn(() => [item('a')]);
    reg.register({ prefix: '#', id: 'tags', getItems });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const state = { refreshKey: 0 };
    const build = (): ReactNode => {
      useProviderItems({
        registry: reg,
        isOpen: true,
        prefix: '#',
        query: '',
        refreshKey: state.refreshKey,
        onError: () => {},
      });
      return null;
    };
    await act(async () => root.render(createElement(build)));
    expect(getItems).toHaveBeenCalledTimes(1);

    await act(async () => root.render(createElement(build))); // 同一 refreshKey 重渲:不重跑
    expect(getItems).toHaveBeenCalledTimes(1);

    state.refreshKey = 1; // 数据版本变了:重跑一次取候选
    await act(async () => root.render(createElement(build)));
    expect(getItems).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
    host.remove();
  });
});
