/**
 * 主窗候选体系的接线(shell 层,设计 §4.2 数据流):前缀 -> 候选 -> 下拉。
 *
 * 2/3 Task 5:浮层外壳与它的「接受分派」已随统一输入框删除。采纳三类前缀的副作用全部在
 * `StreamView.acceptAt`(决策在纯函数 `effectFor`)里执行,这里只剩**取候选**这一半:
 * 1. **候选**:三个 provider(命令/笔记/标签)注册进本 hook 私有的注册表;输入变化由
 *    `useProviderItems` 取回(带序号守卫,旧回包丢弃)。prefix/query 通过 `onFilterChange`
 *    从 use-palette 回传(避免 host 读 controller 造成数据环)。
 * 2. **持久化**:`ui.pinned.tags` / `ui.palette.limit` 与三个 MRU 读一次;坏数据由
 *    palette-settings 消毒(T4 复审判 N1/N2 在注入侧收口)。
 *
 * 候选缓存每次进 `@` 档作废一次:刚保存的笔记也能立刻被快速打开搜到。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../shared/api';
import type { CommandRegistry } from '../../shared/commands';
import type { Note, TagCount } from '../../shared/types';
import type { Context } from '../../shared/when';
import type { ErrorKind } from './ErrorBar';
import type { RowDecoration } from '../palette/PaletteRow';
import { createNoteCandidates, recentConditions } from '../palette/note-candidates';
import { buildAppProviders } from '../palette/providers/app-providers';
import { usePaletteSettings } from '../palette/use-palette-settings';
import { createTagCandidates } from '../palette/tag-candidates';
import { commandDecorations } from '../palette/providers/commands';
import { noteDecorationsFor } from '../palette/providers/notes';
import { tagDecorations } from '../palette/providers/tags';
import { usePalette } from '../palette/use-palette';
import type { PaletteController } from '../palette/use-palette';
import { paletteBinding } from '../palette/palette-binding';
import { useProviderItems } from '../palette/use-provider-items';

export interface AppPaletteOptions {
  /** 已接线的命令注册表(use-app-commands) */
  registry: CommandRegistry;
  /** 现读上下文键(sidebar / editing / palette.open / 排序) */
  getContext: () => Context;
  /** 标签数据版本(主窗 loadTags 成功时递增):`#` 候选池据此作废缓存 */
  tagsVersion: number;
  setError: (kind: ErrorKind, message: string) => void;
}

export interface AppPalette {
  controller: PaletteController;
  decorations: Readonly<Record<string, RowDecoration>>;
}

interface FilterState {
  prefix: string;
  query: string;
}

export function useAppPalette(options: AppPaletteOptions): AppPalette {
  const latest = useRef(options);
  latest.current = options;
  const [filter, setFilter] = useState<FilterState>({ prefix: '', query: '' });
  const { settings } = usePaletteSettings();
  const tagsRef = useRef<readonly TagCount[]>([]);
  const noteIndex = useRef(new Map<number, Note>());

  // 候选池(每次进 `@` 档作废):分页取最近 200 条;FTS 追加查询走同一 IPC
  const pool = useMemo(
    () => createNoteCandidates((offset) => api.queryNotes(recentConditions(), offset)),
    [],
  );

  // 标签候选池(复审 I1):整个数组缓存在会话内,缓存键 = 标签数据版本;
  // 版本由主窗 loadTags 成功时递增,所以标签增删改后下一次取候选会重打库
  const tagPool = useMemo(() => createTagCandidates(() => api.listTags()), []);

  const providers = useMemo(
    () =>
      buildAppProviders({
        registry: options.registry,
        getContext: () => latest.current.getContext(),
        pool,
        tagPool,
        // 版本现读(复审 m2):注册表身份不随版本变化,`#` 的重取由下面的 refreshKey 驱动
        getTagsVersion: () => latest.current.tagsVersion,
        noteIndex,
        tagsRef,
      }),
    [options.registry, pool, tagPool],
  );

  // 进 `@` 档即作废候选缓存(刚保存的笔记也要能搜到)。必须在 useProviderItems 的 effect
  // 之前声明:同一次提交里 effect 按声明顺序执行,先清缓存、再取候选,否则取到的还是上一次的旧缓存。
  useEffect(() => {
    if (filter.prefix === '@') pool.refresh();
  }, [filter.prefix, pool]);

  const items = useProviderItems({
    registry: providers,
    // 常驻驱动(任务 5):统一输入框把前缀写进控制器时并没有"打开"动作,
    // 所以"有前缀"就要取候选 —— 否则下拉永远拿不到数据
    isOpen: filter.prefix !== '',
    prefix: filter.prefix,
    query: filter.query,
    // 只有 `#` 的候选与标签数据版本有关;其余前缀传常量,版本变化不重跑
    refreshKey: filter.prefix === '#' ? options.tagsVersion : 0,
    onError: (message) => latest.current.setError('action', message),
  });

  // prefix/query -> FilterState:值没变就沿用旧对象,避免每帧多一次渲染
  const onFilterChange = useCallback((next: FilterState) => {
    setFilter((prev) =>
      prev.prefix === next.prefix && prev.query === next.query ? prev : next,
    );
  }, []);

  // 前缀实时驱动:身份必须稳定 —— usePalette 的 setQuery 依赖本函数,一变就换新 ->
  // 依赖它的 effect 每渲染重跑(setQuery 内部会把高亮行按回第一行,表现为候选方向键选不动)。
  const splitPrefix = useCallback((raw: string) => {
    const match = providers.resolve(raw);
    if (match === undefined || match.provider.prefix === '') return null;
    return { prefix: match.provider.prefix, query: match.query };
  }, [providers]);

  // 固定项/最近用过/上限的推导在 palette-binding.ts(按前缀分派,三个 id 空间不串)
  const binding = paletteBinding(filter.prefix, settings);

  const controller = usePalette({
    items,
    pinned: binding.pinned,
    mru: binding.mru,
    limit: binding.limit,
    onFilterChange,
    splitPrefix,
  });

  const decorations = useMemo((): Readonly<Record<string, RowDecoration>> => {
    if (filter.prefix === '>') {
      return commandDecorations(options.registry, options.getContext());
    }
    if (filter.prefix === '#') return tagDecorations(tagsRef.current);
    return noteDecorationsFor(items, noteIndex.current);
  }, [filter.prefix, items, options.registry, options.getContext]);

  return { controller, decorations };
}
