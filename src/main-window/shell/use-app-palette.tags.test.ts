/**
 * `#`(标签)前缀的接线读数(T6 修复轮 + 2/3 Task 5):I2 卸载兜底静默保存后 `#` 立刻新鲜、
 * m2 数据版本变化不再换新注册表。自 use-app-palette.test.ts 分出(那个文件 191 行,逼近 200 行红线)。
 * m1 的"换新窗口内接受旧行"随 accepting 死半删除(接受复核已随浮层外壳消失)。
 */
// @vitest-environment jsdom
import { act, createElement, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultContext } from '../../shared/keys';
import type { Note, TagCount } from '../../shared/types';
import { notifyTagsChanged, onTagsChanged } from '../data/tags-changed';
import { updateNote as writeNote } from '../data/note-writes';
import { useSaveOnUnmount } from '../editor/use-save-on-unmount';
import { buildAppProviders } from '../palette/providers/app-providers';
import { createTagCandidates } from '../palette/tag-candidates';
import { mountAppPalette } from './__fixtures__/app-palette-harness';
import type { AppPaletteHarness } from './__fixtures__/app-palette-harness';

const { queryNotes, listTags, getSetting, setSetting, updateNote } = vi.hoisted(() => ({
  queryNotes: vi.fn(async () => [] as Note[]),
  listTags: vi.fn(async () => [] as TagCount[]),
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  setSetting: vi.fn(async () => {}),
  updateNote: vi.fn(async (): Promise<Note | null> => null),
}));
vi.mock('../../shared/api', () => ({ api: { queryNotes, listTags, getSetting, setSetting, updateNote } }));

const tag = (path: string, subtree: number): TagCount => ({
  id: path.length,
  path,
  depth: 0,
  sort_order: 0,
  self_count: subtree,
  subtree_count: subtree,
});

let h: AppPaletteHarness;
beforeEach(() => {
  queryNotes.mockResolvedValue([]);
  listTags.mockResolvedValue([tag('工作', 4), tag('生活', 1)]);
  getSetting.mockResolvedValue(null);
  h = mountAppPalette();
});
afterEach(() => {
  h.unmount();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

const labels = (): string[] => h.controller().rows.map((r) => r.item.label);

/** 通知的合并窗口是宏任务:等一个 setTimeout(0) 才能看到出口回调 */
const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 卸载兜底保存探针:与 EditPanel 同一个 hook,挂载后卸载即触发一次静默写库 */
function SaveProbe(): ReactNode {
  const initial = useRef('旧正文');
  const saved = useRef(false);
  const cancelled = useRef(false);
  const getText = useCallback(() => '旧正文 #编辑时新建的标签', []);
  useSaveOnUnmount({ noteId: 7, initial, getText, saved, cancelled });
  return null;
}

describe('`#` 候选:标签新鲜度出口(复审 I2)', () => {
  it('卸载兜底静默保存后 `#` 立刻看到新标签(修前:重新进 `#` 档也陈旧)', async () => {
    await h.type('#');
    expect(labels()).toEqual(['工作', '生活']);

    let reloads = 0;
    const off = onTagsChanged(() => {
      reloads += 1;
    });

    // 编辑态加了个新标签 -> 面板卸载 -> 静默写库(没有任何 reload 回调通道的那条路径)
    const probeHost = document.createElement('div');
    document.body.appendChild(probeHost);
    const probeRoot = createRoot(probeHost);
    await act(async () => {
      probeRoot.render(createElement(SaveProbe));
    });
    updateNote.mockResolvedValue({
      id: 7,
      content: '旧正文',
      created_at: '2026-09-22 10:00:00',
      tags: ['编辑时新建的标签'],
    });
    listTags.mockResolvedValue([tag('工作', 4), tag('生活', 1), tag('编辑时新建的标签', 0)]);
    await act(async () => {
      probeRoot.unmount();
    });
    await act(macrotask); // 出口的合并窗口:宏任务
    probeHost.remove();

    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(reloads).toBe(1); // 写库成功即通知出口(修前:0 —— 静默写库没有出口)

    h.setTagsVersion(reloads); // App.tsx 的接线:出口 -> loadTags 成功 -> tagsVersion +1
    await h.flush();
    await h.type('#编辑');
    expect(labels()).toEqual(['编辑时新建的标签']); // 修前:陈旧 -> 空列表(无匹配结果)
    off();
  });

  it('一次写库只重载一次:出口通知 + 既有 reload 通知被合并', async () => {
    let reloads = 0;
    const off = onTagsChanged(() => {
      reloads += 1;
    });
    updateNote.mockResolvedValue(null);
    await act(async () => {
      await writeNote(7, '买牛奶 #生活'); // 写库出口的通知
      notifyTagsChanged(); // 既有 reload 也会通知一次(两次都在同一轮事件循环里)
    });
    await act(macrotask);
    expect(reloads).toBe(1); // 不去重就是 2 次全树 list_tags
    off();
  });
});

describe('`#` 候选:数据版本不换新注册表(复审 m2)', () => {
  it('同一个 registry 实例在版本变化后仍取到新数据(所以 memo 不必依赖版本)', async () => {
    let version = 0;
    let rows: TagCount[] = [tag('工作', 4)];
    const registry = buildAppProviders({
      registry: h.registry,
      getContext: () => defaultContext(),
      pool: { current: async () => [], refresh: () => {} },
      tagPool: createTagCandidates(async () => rows),
      getTagsVersion: () => version,
      noteIndex: { current: new Map() },
      tagsRef: { current: [] },
    });
    const ids = async (): Promise<string[]> =>
      (await registry.resolve('#')!.provider.getItems('')).map((i) => i.id);

    expect(await ids()).toEqual(['工作']);
    version = 1; // 版本变了,注册表实例没换
    rows = [tag('工作', 4), tag('新标签', 0)];
    expect(await ids()).toEqual(['工作', '新标签']);
  });

  it('对照:`#` 前缀下版本变化照旧重取候选(版本就是给它用的)', async () => {
    await h.type('#');
    expect(listTags).toHaveBeenCalledTimes(1);
    listTags.mockResolvedValue([tag('工作', 4), tag('生活', 1), tag('新标签', 0)]);
    h.setTagsVersion(1);
    await h.flush();
    expect(listTags).toHaveBeenCalledTimes(2);
    expect(labels()).toContain('新标签');
  });

  it('标签版本变化不再让无关前缀重跑取候选(`>` 前缀命令数不变)', async () => {
    await h.type('>');
    expect(h.commandItemRuns()).toBe(1);
    h.setTagsVersion(1);
    await h.flush();
    expect(h.commandItemRuns()).toBe(1); // 修前:注册表换新 -> effect 重跑 -> 2
  });
});
