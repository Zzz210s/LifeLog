// @vitest-environment jsdom
/**
 * 侧栏设置键的读写:
 * ① 开关「实体树里显示关系」(`tag_tree_show_relations`,**默认开**;不回读旧键 `tag_tree_show_carry` ——
 *    旧键是「携带」时代的开关,与现在的关系不是一回事,写库写新键);
 * ② 单击实体行的行为模式(`sidebar_click_mode`,默认 `filter`,非法值**与旧值 select** 回落 `filter`)。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLICK_MODE_LABELS,
  CLICK_MODE_ORDER,
  nextClickMode,
  useSidebarState,
  type SidebarStateApi,
} from './use-sidebar-state';

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

describe('开关「实体树里显示关系」的键与旧键', () => {
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

describe('单击行为模式键 sidebar_click_mode', () => {
  /** 换一份设置重挂一次(同一用例里要查多个读数时用;`beforeEach` 已建好 root/host) */
  const remount = async (map: Record<string, string | null>): Promise<void> => {
    act(() => root.unmount());
    host.remove();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    settings(map);
    await act(async () => root.render(createElement(Probe)));
    await settle();
  };

  it('缺键:回默认 filter', async () => {
    await remount({});
    expect(state?.clickMode).toBe('filter');
  });

  it('非法值(拼写 / 空串 / 未知 / 大小写)一律回 filter', async () => {
    for (const raw of ['opne', '', 'open ', 'Filter', 'both', 'true']) {
      await remount({ sidebar_click_mode: raw });
      expect(state?.clickMode).toBe('filter');
    }
  });

  it('旧值 select(两档化之前存下的第三档)回落到 filter,不被采纳', async () => {
    await remount({ sidebar_click_mode: 'select' });
    expect(state?.clickMode).toBe('filter');
    // 回落只读不写:库里那条旧值原样留着,用户下次手动切档才覆盖它
    expect(setSetting).not.toHaveBeenCalledWith('sidebar_click_mode', expect.anything());
  });

  it('读取合法两值(filter / open)', async () => {
    for (const v of ['filter', 'open']) {
      await remount({ sidebar_click_mode: v });
      expect(state?.clickMode).toBe(v);
    }
  });

  it('setClickMode 立刻改会话内值并写库(静默失败不影响会话内值)', async () => {
    await remount({ sidebar_click_mode: 'filter' });
    await act(async () => state?.setClickMode('open'));
    expect(state?.clickMode).toBe('open');
    expect(setSetting).toHaveBeenCalledWith('sidebar_click_mode', 'open');
    setSetting.mockRejectedValueOnce(new Error('库不可写'));
    await act(async () => state?.setClickMode('filter'));
    await settle();
    expect(state?.clickMode).toBe('filter');
  });

  it('nextClickMode 轮转顺序 filter -> open -> filter', () => {
    expect(nextClickMode('filter')).toBe('open');
    expect(nextClickMode('open')).toBe('filter');
  });

  it('CLICK_MODE_ORDER / CLICK_MODE_LABELS 与两模式一一对应', () => {
    expect([...CLICK_MODE_ORDER]).toEqual(['filter', 'open']);
    expect(CLICK_MODE_LABELS).toEqual({ filter: '筛选', open: '打开' });
  });
});
