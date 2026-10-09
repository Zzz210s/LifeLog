/**
 * 主窗候选体系的接线(shell 层,设计 §4.2 数据流):前缀 -> 候选 -> 下拉。
 *
 * 2/3 Task 5:浮层外壳与它的「接受分派」已随统一输入框删除。采纳三类前缀的副作用全部在
 * `StreamView.acceptAt`(决策在纯函数 `effectFor`)里执行,这里只剩**取候选**这一半:
 * 1. **候选**:命令 provider + **一个实体 provider**(计划 T3.2:原笔记/标签两个 provider 合并;
 *    默认档与 `@` 取全部实体,`#` 收窄到树内实体)注册进本 hook 私有的注册表;输入变化由
 *    `useProviderItems` 取回(带序号守卫,旧回包丢弃)。prefix/query 通过 `onFilterChange`
 *    从 use-palette 回传(避免 host 读 controller 造成数据环)。
 * 2. **持久化**:`ui.pinned.tags` / `ui.palette.limit` 与三个 MRU 读一次;坏数据由
 *    palette-settings 消毒(T4 复审判 N1/N2 在注入侧收口)。
 *
 * 候选缓存每次进 `@` 档作废一次:刚保存的笔记也能立刻被快速打开搜到。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../../shared/api';
import type { CommandRegistry } from '../../shared/commands';
import type { TagMruSource } from '../../shared/tag-mru';
import type { TagCount } from '../../shared/types';
import type { Context } from '../../shared/when';
import type { ErrorKind } from './ErrorBar';
import type { RowDecoration } from '../palette/PaletteRow';
import { createEntityCandidates } from '../palette/entity-candidates';
import { buildAppProviders } from '../palette/providers/app-providers';
import { usePaletteSettings } from '../palette/use-palette-settings';
import { commandDecorations } from '../palette/providers/commands';
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
  /**
   * 固定标签 + 标签 MRU(直接引用本层 `usePaletteSettings` 的那一份实例,不再新建第二份)。
   * 侧栏与关系图的标签菜单「携带…」候选靠它拿到与 `#` 补全同一套三档排序;还没读回来时为 null。
   */
  tagMru: TagMruSource | null;
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

  // 实体候选池(计划 T3.2):`#` / `@` / 默认档共用同一份;两路 IPC(全部实体 + 树内实体)
  // 按数据版本缓存,版本由主窗 loadTags 成功时递增 —— 实体增删改后下一次取候选就重打库。
  const entityPool = useMemo(
    () =>
      createEntityCandidates(
        () => api.completeNotes(),
        () => api.listTags(),
        (rows) => {
          tagsRef.current = rows;
        },
      ),
    [],
  );

  const providers = useMemo(
    () =>
      buildAppProviders({
        registry: options.registry,
        getContext: () => latest.current.getContext(),
        entityPool,
        // 版本现读(复审 m2):注册表身份不随版本变化,重取由下面的 refreshKey 驱动
        getVersion: () => latest.current.tagsVersion,
        tagsRef,
      }),
    [options.registry, entityPool],
  );

  const items = useProviderItems({
    registry: providers,
    // 常驻驱动(任务 5):统一输入框把前缀写进控制器时并没有"打开"动作,
    // 所以"有前缀"就要取候选 —— 否则下拉永远拿不到数据
    isOpen: filter.prefix !== '',
    prefix: filter.prefix,
    query: filter.query,
    // 实体前缀(`#` / `@`)的候选与数据版本有关;其余前缀传常量,版本变化不重跑
    refreshKey:
      filter.prefix === '#' || filter.prefix === '@' ? options.tagsVersion : 0,
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
    return {};
  }, [filter.prefix, options.registry, options.getContext]);

  return { controller, decorations, tagMru: settings };
}
