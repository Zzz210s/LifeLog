/**
 * 主窗候选体系的整体接线(自 App.tsx 抽出以守行数红线):上下文键快照 + 三个 provider 接线 +
 * 应用内快捷键监听(Task 7 起快捷键 = 聚焦统一输入框并预填前缀,不再开关浮层)。
 * `prefill(prefix)` 是唯一入口:快捷键与侧栏「筛选标签」(Task 4)都走它。
 * App 只负责把状态递进来、把 controller/decorations/unified/prefill 递出去。
 */
import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import type { CommandRegistry } from '../../shared/commands';
import type { FilterConditions } from '../../shared/filter-conditions';
import { KEYS } from '../../shared/keys';
import type { Note } from '../../shared/types';
import type { Context } from '../../shared/when';
import { usePaletteHotkeys } from '../palette/use-palette-hotkeys';
import type { PaletteController } from '../palette/use-palette';
import type { RowDecoration } from '../palette/PaletteRow';
import type { UnifiedController } from '../unified/use-unified-input';
import type { ErrorKind } from './ErrorBar';
import { useAppHotkeys } from './use-app-hotkeys';
import { useAppPalette } from './use-app-palette';

export interface MainPaletteOptions {
  /** 主区容器(关闭浮层时的焦点归位锚点,须 tabIndex=-1) */
  anchorRef: RefObject<HTMLElement | null>;
  registry: CommandRegistry;
  executeCommand: (id: string) => Promise<void>;
  /** 标签数据版本(`#` 候选池据此作废缓存) */
  tagsVersion: number;
  tabCount: number;
  sidebarVisible: boolean;
  editingId: number | null;
  notes: readonly Note[];
  loadingNotes: boolean;
  conditions: FilterConditions;
  clearFilters: () => void;
  toggleTag: (path: string) => void;
  setError: (kind: ErrorKind, message: string) => void;
  /** 预填前的前置动作:设置页里输入框是 `hidden` 的,先把信息流视图切回来 */
  beforePrefill: () => void;
}

export interface MainPalette {
  controller: PaletteController;
  decorations: Readonly<Record<string, RowDecoration>>;
  /** 统一输入框控制器(由 StreamView 上抛):状态取用方从它读 */
  unified: RefObject<UnifiedController | null>;
  /** 聚焦统一输入框并预填前缀(快捷键与侧栏「筛选标签」共用这一条通道) */
  prefill: (prefix: string) => void;
}

/**
 * 条件对象的排序 -> 命令上下文两键(与 sidebar 同处映射)。
 * 抽成纯函数:排序命令的勾选态靠它驱动,必须可单独测试。
 */
export function sortContextKeys(sort: FilterConditions['sort']): {
  sortNewest: boolean;
  sortOldest: boolean;
} {
  return { sortNewest: sort === 'newest', sortOldest: sort === 'oldest' };
}

export function useMainPalette(o: MainPaletteOptions): MainPalette {
  /** 上下文键快照(when / 勾选态都从这里求值;组件不裸写键名) */
  const getContext = useCallback(
    (): Context => ({
      sidebar: o.sidebarVisible,
      editing: o.editingId !== null,
      [KEYS.paletteOpen]: false, // 浮层自己的开合不影响任何命令的 when(避免自引用)
      [KEYS.tabCount]: o.tabCount,
      [KEYS.tabMultiple]: o.tabCount > 1,
      ...sortContextKeys(o.conditions.sort),
    }),
    [o.sidebarVisible, o.editingId, o.tabCount, o.conditions.sort],
  );

  const palette = useAppPalette({
    anchorRef: o.anchorRef,
    registry: o.registry,
    getContext,
    notes: o.notes,
    loadingNotes: o.loadingNotes,
    conditions: o.conditions,
    clearFilters: o.clearFilters,
    toggleTag: o.toggleTag,
    executeCommand: o.executeCommand,
    tagsVersion: o.tagsVersion,
    setError: o.setError,
  });

  // 应用内快捷键(默认 Ctrl+P / Ctrl+Shift+P,可在设置页自设):命中即聚焦统一输入框并预填前缀
  const unified = useRef<UnifiedController | null>(null);
  const prefill = useCallback(
    (prefix: string) => {
      o.beforePrefill();
      unified.current?.prefill(prefix);
    },
    [o.beforePrefill],
  );
  const readHotkeys = useAppHotkeys();
  usePaletteHotkeys({ onPrefill: prefill, read: readHotkeys });

  return { controller: palette.controller, decorations: palette.decorations, unified, prefill };
}
