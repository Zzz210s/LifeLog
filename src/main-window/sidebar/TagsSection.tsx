/**
 * 侧栏「标签」分区(spec 6.1):树/扁平双模式 + 计数导轨 + 选中态。
 * 时间标签已降级为普通标签(D3):本分区就是全部标签(含 `时间排序` 根),
 * 可展开、可右键管理;关键词过滤已改为走统一输入框(计划 Task 4),本分区不再有过滤态。
 * 选中态与筛选栏 tags[] 是同一份条件对象(上层传入 conditions 派生);
 * 点击 = applyTagPick(含子级 true),再点 = 移除;右键打开 TagMenu 管理标签。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import { itemPaths } from '../../shared/filter-conditions';
import type { TagMruSource } from '../../shared/tag-mru';
import type { TagCount } from '../../shared/types';
import { TagMenu } from './TagMenu';
import { TagRowList } from './TagRowList';
import { TagsHeader } from './TagsHeader';
import { TagRootDropBar } from './TagRootDropBar';
import { buildTree, filterTree, flattenTree, isManageable, toggleTagPick } from './tag-tree';
import type { ManagedNode, TagNode } from './tag-tree';
import { useTagDrag } from './use-tag-drag';
import { useTagFacts } from './use-tag-facts';
import { useTagFlash } from './use-tag-flash';
import { useTagSearch } from './use-tag-search';
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
  /** 设置开关「标签树里显示关系」(默认开,侧栏头部与设置页同一份状态);打开后行尾追加关系的**值**小字 */
  showRelations?: boolean;
  onShowRelationsChange?: (v: boolean) => void;
}

export function TagsSection(p: TagsSectionProps): ReactNode {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ node: ManagedNode; x: number; y: number } | null>(null);
  const [factsNonce, setFactsNonce] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { flash, showFlash } = useTagFlash();
  const search = useTagSearch();

  // 全量标签行(含时间标签)就是本分区的数据源(D3)
  const visibleRows = p.tagRows;
  // 关系事实:后端只有逐标签读数,这里整批取并按 nonce 重取(菜单里改完要刷新)
  const tagIds = useMemo(() => visibleRows.map((r) => r.id), [visibleRows]);
  const facts = useTagFacts(tagIds, factsNonce);

  const tree = useMemo(() => buildTree(p.tagRows), [p.tagRows]);
  const shown = useMemo(() => filterTree(tree, search.query), [tree, search.query]);
  const activePaths = useMemo(() => new Set(itemPaths(p.conditions, 'tag')), [p.conditions]);
  const excludedPaths = useMemo(
    () => new Set(itemPaths(p.conditions, 'excludeTag')),
    [p.conditions]
  );

  const toggleExpand = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** 行点击:排除侧 -> 撤掉该排除;引入侧 -> 移除;都不在 -> 加入(含子级) */
  const onToggle = useCallback(
    (node: TagNode) => p.onPatch(toggleTagPick(p.conditions, node.path)),
    [p]
  );

  const onContextMenu = useCallback((e: React.MouseEvent, node: TagNode) => {
    e.preventDefault();
    if (!isManageable(node)) return; // 补出的结构节点(无 DB id)不可管理:不出菜单
    // 菜单宽 224px(w-56)、高最多 320px,钳制不超出视口
    setMenu({
      node,
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 232)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 328)),
    });
  }, []);

  const onMenuDone = useCallback(
    (message: string, pathChange?: { from: string; to: string }) => {
      setMenu(null);
      showFlash(message);
      setFactsNonce((n) => n + 1); // 关系可能被改动,重取事实
      p.onTagsMutated(pathChange);
    },
    [p]
  );

  /** 关闭菜单(Esc/点外/面板取消):关系面板是即时写库的,关时重取一次事实 */
  const onMenuClose = useCallback(() => {
    setMenu(null);
    setFactsNonce((n) => n + 1);
  }, []);

  const isExpanded = (path: string): boolean => search.filtering || !collapsed.has(path);

  /** 悬停自动展开(T2):只展开不收起 —— 自动展开的计时期间用户可能已手动展开过 */
  const expandPath = useCallback((path: string) => {
    setCollapsed((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, []);

  // 拖拽移动(spec 6):成功走与右键移动同一级联链,失败(预校验/后端)红色提示
  const drag = useTagDrag({
    roots: tree,
    expanded: isExpanded,
    onAutoExpand: expandPath,
    listRef,
    onMoved: (pathChange) => {
      showFlash('已移动标签');
      p.onTagsMutated(pathChange);
    },
    onError: (message) => showFlash(message, 'error'),
  });

  // 扁平模式:收窄后的树拉平为深度优先序列
  const flatNodes = useMemo(() => flattenTree(shown), [shown]);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="标签分区">
      <TagsHeader
        flash={flash}
        mode={p.mode}
        onModeChange={p.onModeChange}
        onFilterTags={p.onFilterTags}
        showRelations={p.showRelations === true}
        onToggleRelations={() => p.onShowRelationsChange?.(!(p.showRelations === true))}
        searchOpen={search.searchOpen}
        query={search.query}
        onQueryChange={search.setQuery}
        onToggleSearch={search.toggleSearch}
        onCloseSearch={search.closeSearch}
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
          <p className="px-2 py-3 text-label text-muted">还没有标签,在输入栏写 #标签 试试</p>
        ) : (
          <TagRowList
            nodes={p.mode === 'tree' ? shown : flatNodes}
            flat={p.mode !== 'tree'}
            selected={activePaths}
            excluded={excludedPaths}
            expanded={isExpanded}
            onToggle={onToggle}
            onToggleExpand={toggleExpand}
            onContextMenu={onContextMenu}
            drag={drag}
            facts={facts}
            showRelations={p.showRelations === true}
          />
        )}
        {visibleRows.length > 0 && search.filtering && shown.length === 0 && (
          <p className="px-2 py-2 text-label text-muted">没有匹配的标签</p>
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
      {menu && (
        <TagMenu
          node={menu.node}
          x={menu.x} y={menu.y}
          tagRows={p.tagRows}
          tagMru={p.tagMru}
          onClose={onMenuClose}
          onDone={onMenuDone}
        />
      )}
    </section>
  );
}
