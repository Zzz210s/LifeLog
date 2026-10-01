// @vitest-environment jsdom
/**
 * 候选池缓存的组件级证据:首次取全池、同版本重渲不重取、版本变化重取一次、
 * 失败退化为空池且不抛、卸载后不再接受迟到结果。
 */
import { act, createElement, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteTitle } from '../../shared/types';
import { useNoteTitles } from './use-note-titles';

const { completeNotes } = vi.hoisted(() => ({
  completeNotes: vi.fn(async (): Promise<NoteTitle[]> => [{ id: 1, title: '甲' }]),
}));
vi.mock('../../shared/api', () => ({ api: { completeNotes } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let titles: readonly NoteTitle[] = [];
let ready = false;
let setVersion: ((v: number) => void) | null = null;
let bump: (() => void) | null = null;

function Probe({ version }: { version: number }): ReactNode {
  const [v, setV] = useState(version);
  const [extra, setExtra] = useState(0);
  setVersion = setV;
  bump = () => setExtra((n) => n + 1);
  const got = useNoteTitles(v);
  titles = got.titles;
  ready = got.ready;
  return createElement('span', null, String(extra));
}

const settle = (): Promise<void> =>
  act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });

beforeEach(() => {
  completeNotes.mockClear();
  completeNotes.mockImplementation(async () => [{ id: 1, title: '甲' }]);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('useNoteTitles(候选池缓存)', () => {
  it('首次取全池并置 ready;同版本重渲不重取', async () => {
    await act(async () => root.render(createElement(Probe, { version: 0 })));
    await settle();
    expect(completeNotes).toHaveBeenCalledTimes(1);
    expect(completeNotes).toHaveBeenCalledWith();
    expect(titles).toEqual([{ id: 1, title: '甲' }]);
    expect(ready).toBe(true);

    await act(async () => bump?.());
    await settle();
    expect(completeNotes).toHaveBeenCalledTimes(1);
  });

  it('版本变化重取一次', async () => {
    await act(async () => root.render(createElement(Probe, { version: 0 })));
    await settle();
    await act(async () => setVersion?.(1));
    await settle();
    expect(completeNotes).toHaveBeenCalledTimes(2);
  });

  it('失败退化为空池、ready=false、不抛', async () => {
    completeNotes.mockRejectedValueOnce(new Error('boom'));
    await act(async () => root.render(createElement(Probe, { version: 0 })));
    await settle();
    expect(titles).toEqual([]);
    expect(ready).toBe(false);
  });

  it('卸载后迟到的结果不再进入状态', async () => {
    let release!: (pool: NoteTitle[]) => void;
    completeNotes.mockImplementationOnce(
      () => new Promise<NoteTitle[]>((res) => (release = res))
    );
    await act(async () => root.render(createElement(Probe, { version: 0 })));
    act(() => root.unmount());
    release([{ id: 2, title: '乙' }]);
    await settle();
    expect(titles).toEqual([]); // 迟到的池没有被接受
  });
});
