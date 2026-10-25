/**
 * 侧栏「标签」分区(spec 6.1):树/扁平双模式 + 计数导轨 + 选中态 + 关系小字。
 * 单击行为自 2026-10-16 起可配置(设计 §2):本组件只做两件事 —— 把行派发的意图交给
 * `useTagClick` 执行,以及渲染它给的预览卡片;条件补丁与预览状态都不在这里(分区守 200 行红线)。
 * 展开是纯侧栏视觉(折叠集合在本组件),所以 `expand` 意图不出这个文件。
 * 右键菜单的状态与位置钳制在 `use-tag-menu`,本体与五个子面板在 `TagMenu`。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import { itemPaths } from '../../shared/filter-conditions';
import type { TagMruSource } from '../../shared/tag-mru';
import type { TagCount } from '../../shared/types';
import { TagMenu } from './TagMenu';
import { TagRowList } from './TagRowList';
import { SidebarSelectionMount } from './SidebarSelectionMount';
import { useSearchRowHeight } from '../data/use-search-row-height';
import { useSidebarSelection } from './use-sidebar-selection';
import { TagsHeader } from './TagsHeader';
import { TagRootDropBar } from './TagRootDropBar';
import { setTagScope, toggleExcludeTag } from './tag-click-patch';
import type { RowIntent } from './tag-row-action';
import { buildTree, filterTree, flattenTree } from './tag-tree';
import type { TagNode } from './tag-tree';
import { useTagDrag } from './use-tag-drag';
import { useTagFacts } from './use-tag-facts';
import { useTagMenu } from './use-tag-menu';
import { useTagSearch } from './use-tag-search';
import type { TagClickApi } from './use-tag-click';
import type { TagViewMode } from './use-sidebar-state';

export interface TagsSectionProps {
  conditions: FilterConditions;
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 全量标签行(list_tags,含 id),树与扁平共用 */
  tagRows: TagCount[];
  /** 固定标签 + 标签 MRU(标签菜单「引用…」候选的三档排序);无固定项/无最近用过传 null */
  tagMru: TagMruSource | null;
  mode: TagViewMode;
  onModeChange: (m: TagViewMode) => void;
  /** 点「筛选标签」:交给上层聚焦统一输入框并预填 `#` */
  onFilterTags: () => void;
  /** 管理(改名/移动/删除)成功后通知上层刷新标签与筛选条件 */
  onTagsMutated: (pathChange?: { from: string; to: string }) => void;
  /** 设置开关「实体树里显示关系」(默认开,只由设置页改);打开后行尾追加关系的**值**小字 */
  showRelations?: boolean;
  /** 单击接线(设计 2026-10-16,计划 T4):模式 + 光标/预览状态 + 意图执行都在 `useTagClick`(App 持有) */
  click: TagClickApi;
}

export function TagsSection(p: TagsSectionProps): ReactNode {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [factsNonce, setFactsNonce] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const click = p.click;
  const { flash, showFlash } = click;
  const search = useTagSearch();
  const menu = useTagMenu({
    showFlash,
    onMutated: p.onTagsMutated,
    onFactsStale: () => setFactsNonce((n) => n + 1),
  });

  // 全量标签行(含时间标签)就是本分区的数据源(D3)
  const visibleRows = p.tagRows;
  // 关系事实:后端只有逐标签读数,这里整批取并按 nonce 重取(菜单里改完要刷新)
  const tagIds = useMemo(() => visibleRows.map((r) => r.id), [visibleRows]);
  const facts = useTagFacts(tagIds, factsNonce);

  const tree = useMemo(() => buildTree(p.tagRows), [p.tagRows]);
  const shown = useMemo(() => filterTree(tree, search.committed), [tree, search.committed]);
  // 引入侧 / 排除侧的路径集合(与条件对象同源)
  const activePaths = useMemo(() => new Set(itemPaths(p.conditions, 'tag')), [p.conditions]);
  const excludedPaths = useMemo(() => new Set(itemPaths(p.conditions, 'excludeTag')), [p.conditions]);

  const toggleExpand = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** 行意图:展开是纯侧栏视觉(折叠集合在本组件),其余交给 `useTagClick` 执行(§4.1) */
  const onIntent = useCallback(
    (intent: RowIntent, node: TagNode) => {
      if (intent !== 'expand') return click.apply(intent, node);
      if (node.children.length > 0) toggleExpand(node.path);
      else showFlash('该实体还没有内容'); // 计数 0 的空实体:三模式都不做事,只给一句话(§4.2)
    },
    [click, showFlash, toggleExpand]
  );

  const isExpanded = (path: string): boolean => search.filtering || !collapsed.has(path);

  /** 悬停自动展开(T2):只展开不收起 —— 自动展开的计时期间用户可能已手动展开过 */
  const expandPath = useCallback((path: string) => {
    setCollapsed((prev) => (prev.has(path) ? new Set([...prev].filter((k) => k !== path)) : prev));
  }, []);

  // 拖拽移动(spec 6):成功走与右键移动同一级联链,失败(预校验/后端)红色提示
  const drag = useTagDrag({
    roots: tree,
    expanded: isExpanded,
    onAutoExpand: expandPath,
    listRef,
    onMoved: (pathChange) => { showFlash('已移动标签'); p.onTagsMutated(pathChange); },
    onError: (message) => showFlash(message, 'error'),
  });

  // 扁平模式:收窄后的树拉平为深度优先序列
  const flatNodes = useMemo(() => flattenTree(shown), [shown]);
  // 行高与多选:行高与主窗快捷搜索栏同一份设置;可见顺序的取法集中在 useSidebarSelection
  const searchRowHeight = useSearchRowHeight().height;
  const { selection, visiblePaths, selectedPaths, idByPath } = useSidebarSelection(visibleRows, p.mode, shown, flatNodes);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="实体分区">
      <TagsHeader
        selection={{ active: selection.active, count: selection.count, onToggle: () => selection.setActive(!selection.active) }}
        flash={flash}
        mode={p.mode}
        onModeChange={p.onModeChange}
        onFilterTags={p.onFilterTags}
        searchOpen={search.searchOpen}
        query={search.query}
        ime={search.ime}
        onToggleSearch={search.toggleSearch}
        onCloseSearch={search.closeSearch}
        searchRowHeight={searchRowHeight}
      />
      <SidebarSelectionMount
        selection={selection}
        selectedPaths={selectedPaths}
        idByPath={idByPath}
        onDeleted={() => p.onTagsMutated(undefined)}
        onFlash={showFlash}
      />
      <div
        ref={listRef}
        className="scroll-gutter min-h-0 flex-1 overflow-y-auto px-1 pb-2"
        data-testid="tag-list"
        onDragOver={drag.rootEvents.onDragOverRoot}
        onDrop={drag.rootEvents.onDropRoot}
        onDragLeave={drag.listEvents.onDragLeaveList}
      >
        {visibleRows.length === 0 ? (
          <p className="px-2 py-3 text-label text-muted">还没有实体,在输入栏写 #实体 试试</p>
        ) : (
          <TagRowList
            nodes={p.mode === 'tree' ? shown : flatNodes}
            flat={p.mode !== 'tree'}
            selected={activePaths}
            excluded={excludedPaths}
            expanded={isExpanded}
            clickMode={click.clickMode}
            previewPath={click.previewPath}
            onIntent={onIntent}
            selection={{
              active: selection.active,
              selected: selection.selected,
              onPick: (path, shift) => (shift ? selection.rangeTo(path, visiblePaths) : selection.toggle(path)),
            }}
            onToggleExpand={toggleExpand}
            onContextMenu={menu.onContextMenu}
            drag={drag}
            facts={facts}
            showRelations={p.showRelations === true}
          />
        )}
        {visibleRows.length > 0 && search.filtering && shown.length === 0 && (
          <p className="px-2 py-2 text-label text-muted">没有匹配的实体</p>
        )}
      </div>
      {/* 「移到根级」指示条:拖拽期间渲染;源已在根级时不出现(T8,避免假成功) */}
      {drag.dragging && drag.rootAllowed && (
        <TagRootDropBar
          overRoot={drag.overRoot}
          onDragOver={drag.rootEvents.onDragOverRoot}
          onDrop={drag.rootEvents.onDropRoot}
        />
      )}
      {menu.menu && (
        <TagMenu
          node={menu.menu.node}
          x={menu.menu.x} y={menu.menu.y}
          tagRows={p.tagRows}
          tagMru={p.tagMru}
          conditions={p.conditions}
          onScope={(path, ic) => p.onPatch(setTagScope(p.conditions, path, ic))}
          onToggleExclude={(path) => p.onPatch(toggleExcludeTag(p.conditions, path))}
          onClose={menu.onClose}
          onDone={menu.onDone}
        />
      )}
    </section>
  );
}
