// @vitest-environment jsdom
/**
 * 侧栏开关「标签树里显示关系」(标签关系统一 spec §7):
 * 键 `tag_tree_show_relations`,**默认开**(与整栏显隐同口径,只有显式 'false' 才关);
 * **不回读旧键** `tag_tree_show_carry` —— 旧键是「携带」时代的开关,与现在的关系不是一回事。
 * 写库写新键。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSidebarState, type SidebarStateApi } from './use-sidebar-state';

const { getSetting, setSetting } = vi.hoisted(() => ({
  getSetting: vi.fn<(key: string) => Promise<string | null>>(),
  setSetting: vi.fn<(key: string, value: string) => Promise<void>>(),
}));
vi.mock('../../shared/api', () => ({ api: { getSetting, setSetting } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let state: SidebarStateApi | null = null;

function Probe(): ReactNode {
  state = useSidebarState();
  return null;
}

const settle = (): Promise<void> =>
  act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });

beforeEach(() => {
  getSetting.mockReset();
  setSetting.mockReset();
  setSetting.mockResolvedValue();
  state = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** 只提供关心的两个键,其余回 null(解析层走默认) */
const settings = (map: Record<string, string | null>): void => {
  getSetting.mockImplementation((key) => Promise.resolve(map[key] ?? null));
};

describe('开关「标签树里显示关系」的键与旧键', () => {
  it('新键 true:打开', async () => {
    settings({ tag_tree_show_relations: 'true' });
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect(state?.showRelations).toBe(true);
  });

  it('新键没写过:默认开', async () => {
    settings({});
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect(state?.showRelations).toBe(true);
  });

  it('旧键存在但不生效:旧键显式 false,开关仍默认开;且根本不查旧键', async () => {
    settings({ tag_tree_show_carry: 'false' });
    await act(async () => root.render(createElement(Probe)));
    await settle();
    // 2026-10-06 真库里旧键恰好显式存着 false:回读就会把默认开压成关,这里钉住不生效
    expect(state?.showRelations).toBe(true);
    expect(getSetting).not.toHaveBeenCalledWith('tag_tree_show_carry');
  });

  it('新键明确 false:关(压过可能存在的旧键)', async () => {
    settings({ tag_tree_show_relations: 'false', tag_tree_show_carry: 'true' });
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect(state?.showRelations).toBe(false);
  });

  it('拨开关写新键', async () => {
    settings({});
    await act(async () => root.render(createElement(Probe)));
    await settle();
    await act(async () => state?.setShowRelations(true));
    expect(setSetting).toHaveBeenCalledWith('tag_tree_show_relations', 'true');
  });
});
