/**
 * 浮层接线(shell 层,设计 §4.2 数据流):快捷键 -> 浮层 -> provider -> 命令 run / 笔记跳转 / 标签筛选。
 *
 * 三件事在这里汇合:
 * 1. **候选**:三个 provider(命令/笔记/标签)注册进本 hook 私有的注册表;输入变化由
 *    `useProviderItems` 取回(带序号守卫,旧回包丢弃)。prefix/query 通过 `onFilterChange`
 *    从 use-palette 回传(避免 host 读 controller 造成数据环)。
 * 2. **接受**:命令走 `executeCommand`(内部先 flush 编辑态);笔记走 `useQuickOpen`;
 *    标签走 `toggleTag`(默认含子级)。命令/笔记的 MRU 只在接受时 touch,落盘在空闲/退出。
 * 3. **持久化**:`ui.mru.*` / `ui.pinned.tags` / `ui.palette.limit` 读一次;坏数据由
 *    palette-settings 消毒(T4 复审判 N1/N2 在注入侧收口)。
 *
 * 候选缓存每次打开作废一次:刚保存的笔记也能立刻被快速打开搜到。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { api } from '../../shared/api';
import type { CommandRegistry } from '../../shared/commands';
import type { FilterConditions } from '../../shared/filter-conditions';
import { createProviderRegistry } from '../../shared/quickpick/providers';
import type { Note, TagCount } from '../../shared/types';
import type { Context } from '../../shared/when';
import type { ErrorKind } from './ErrorBar';
import type { RowDecoration } from '../palette/PaletteRow';
import {
  createNoteCandidates,
  recentConditions,
  searchConditions,
} from '../palette/note-candidates';
import { usePaletteSettings } from '../palette/use-palette-settings';
import { createCommandProvider, commandDecorations } from '../palette/providers/commands';
import { createNoteProvider, noteDecorationsFor } from '../palette/providers/notes';
import { createTagProvider, tagDecorations } from '../palette/providers/tags';
import { usePalette } from '../palette/use-palette';
import type { PaletteController } from '../palette/use-palette';
import { useProviderItems } from '../palette/use-provider-items';
import { useQuickOpen } from '../palette/use-quick-open';

export interface AppPaletteOptions {
  anchorRef: RefObject<HTMLElement | null>;
  /** 已接线的命令注册表(use-app-commands) */
  registry: CommandRegistry;
  /** 现读上下文键(sidebar / editing / tab.multiple) */
  getContext: () => Context;
  notes: readonly Note[];
  loadingNotes: boolean;
  conditions: FilterConditions;
  clearFilters: () => void;
  toggleTag: (path: string) => void;
  executeCommand: (id: string) => Promise<void>;
  setError: (kind: ErrorKind, message: string) => void;
}

export interface AppPalette {
  controller: PaletteController;
  decorations: Readonly<Record<string, RowDecoration>>;
}

interface FilterState {
  open: boolean;
  prefix: string;
  query: string;
}

export function useAppPalette(options: AppPaletteOptions): AppPalette {
  const latest = useRef(options);
  latest.current = options;
  const [filter, setFilter] = useState<FilterState>({ open: false, prefix: '', query: '' });
  const { settings, saveMruSoon } = usePaletteSettings();
  const tagsRef = useRef<readonly TagCount[]>([]);
  const noteIndex = useRef(new Map<number, Note>());

  // 候选池(每次打开作废):分页取最近 200 条;FTS 追加查询走同一 IPC
  const pool = useMemo(
    () => createNoteCandidates((offset) => api.queryNotes(recentConditions(), offset)),
    [],
  );

  const providers = useMemo(() => {
    const registry = createProviderRegistry();
    registry.register(
      createCommandProvider({
        registry: options.registry,
        getContext: () => latest.current.getContext(),
      }),
    );
    registry.register(
      createTagProvider({
        listTags: async () => {
          const rows = await api.listTags();
          tagsRef.current = rows;
          return rows;
        },
      }),
    );
    registry.register(
      createNoteProvider({
        getCandidates: async () => {
          const rows = await pool.current();
          for (const note of rows) noteIndex.current.set(note.id, note);
          return rows;
        },
        search: async (query) => {
          const rows = await api.queryNotes(searchConditions(query), 0);
          for (const note of rows) noteIndex.current.set(note.id, note);
          return rows;
        },
      }),
    );
    return registry;
  }, [options.registry, pool]);

  // 每次打开作废候选缓存(刚保存的笔记也要能搜到)。必须在 useProviderItems 的 effect 之前声明:
  // 同一次提交里 effect 按声明顺序执行,先清缓存、再取候选,否则取到的还是上一次的旧缓存。
  useEffect(() => {
    if (filter.open) pool.refresh();
  }, [filter.open, pool]);

  const items = useProviderItems({
    registry: providers,
    isOpen: filter.open,
    prefix: filter.prefix,
    query: filter.query,
    onError: (message) => latest.current.setError('action', message),
  });

  const openNote = useQuickOpen({
    notes: options.notes,
    loading: options.loadingNotes,
    conditions: options.conditions,
    clearFilters: options.clearFilters,
    setError: options.setError,
  });

  // prefix/query -> FilterState:值没变就沿用旧对象,避免每帧多一次渲染
  const onFilterChange = useCallback((next: FilterState) => {
    setFilter((prev) =>
      prev.open === next.open && prev.prefix === next.prefix && prev.query === next.query ? prev : next,
    );
  }, []);

  // 固定项/最近用过**按 provider 分开**:笔记 id 是数字、命令 id 是点分 ASCII、标签是路径,
  // 三者的 id 空间不同 —— 串着传会让"标签名恰好等于某条笔记 id"这类巧合改变列表顺序。
  const pinned = filter.prefix === '#' ? (settings?.pinnedTags ?? []) : [];
  const mru =
    filter.prefix === '>' ? settings?.mruCommands.entries() : filter.prefix === '' ? settings?.mruNotes.entries() : [];

  const controller = usePalette({
    items,
    pinned,
    mru,
    limit: settings?.limit,
    anchorRef: options.anchorRef,
    onFilterChange,
    splitPrefix: (raw) => {
      const match = providers.resolve(raw);
      if (match === undefined || match.provider.prefix === '') return null;
      return { prefix: match.provider.prefix, query: match.query };
    },
    onAccept: (row, keepOpen) => {
      const prefix = filter.prefix;
      if (prefix === '>') {
        settings?.mruCommands.touch(row.item.id);
        saveMruSoon();
        // note.new 会把焦点交给 Composer:即便 Alt+Enter(keepOpen)也必须关掉,否则浮层键盘全哑
        void latest.current.executeCommand(row.item.id).then(() => {
          if (row.item.id === 'note.new') controller.close();
        });
        return;
      }
      if (prefix === '#') {
        latest.current.toggleTag(row.item.id);
        return;
      }
      settings?.mruNotes.touch(row.item.id);
      saveMruSoon();
      openNote(Number(row.item.id));
      if (keepOpen) return;
    },
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
