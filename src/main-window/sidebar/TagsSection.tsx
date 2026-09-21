/**
 * 侧栏「标签」分区(spec 6.1):树/扁平双模式 + 类型过滤 + 计数导轨 + 选中态。
 * 时间标签已降级为普通标签(D3):本分区就是全部标签(含 `时间排序` 根),
 * 可展开、可右键管理;不再有单独的时间分区,也不再有数据层过滤。
 * 选中态与筛选栏 tags[] 是同一份条件对象(上层传入 conditions 派生);
 * 点击 = applyTagPick(含子级 true),再点 = 移除;右键打开 TagMenu 管理标签。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { TagCount } from '../../shared/types';
import { TagMenu } from './TagMenu';
import { TagRowList } from './TagRowList';
import { TagsHeader } from './TagsHeader';
import type { TagFlash } from './TagsHeader';
import { TagRootDropBar } from './TagRootDropBar';
import { buildTree, filterTree, isManageable, toggleTagPick } from './tag-tree';
import type { ManagedNode, TagNode } from './tag-tree';
import { useTagDrag } from './use-tag-drag';
import type { TagViewMode } from './use-sidebar-state';

export interface TagsSectionProps {
  conditions: FilterConditions;
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 全量标签行(list_tags,含 id),树与扁平共用 */
  tagRows: TagCount[];
  mode: TagViewMode;
  onModeChange: (m: TagViewMode) => void;
  /** 管理(改名/移动/删除)成功后通知上层刷新标签与筛选条件 */
  onTagsMutated: (pathChange?: { from: string; to: string }) => void;
}

export function TagsSection(p: TagsSectionProps): ReactNode {
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ node: ManagedNode; x: number; y: number } | null>(null);
  const [flash, setFlash] = useState<TagFlash | null>(null);
  const flashTimer = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 全量标签行(含时间标签)就是本分区的数据源(D3)
  const visibleRows = p.tagRows;

  const tree = useMemo(() => buildTree(visibleRows), [visibleRows]);
  const filtering = query.trim() !== '';
  const shown = useMemo(
    () => (filtering ? filterTree(tree, query) : tree),
    [tree, filtering, query]
  );
  const activePaths = useMemo(() => new Set(p.conditions.tags.map((t) => t.path)), [p.conditions.tags]);
  const excludedPaths = useMemo(
    () => new Set(p.conditions.excludeTags.map((t) => t.path)),
    [p.conditions.excludeTags]
  );

  const showFlash = (text: string, tone: 'ok' | 'error' = 'ok') => {
    setFlash({ text, tone });
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), tone === 'error' ? 3000 : 1500);
  };

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
      p.onTagsMutated(pathChange);
    },
    [p]
  );

  const isExpanded = (path: string): boolean => filtering || !collapsed.has(path);

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
    roots: shown,
    expanded: isExpanded,
    onAutoExpand: expandPath,
    listRef,
    onMoved: (pathChange) => {
      showFlash('已移动标签');
      p.onTagsMutated(pathChange);
    },
    onError: (message) => showFlash(message, 'error'),
  });

  // 扁平模式:树拉平为深度优先序列(保留过滤后的可见集合)
  const flatNodes = useMemo(() => {
    const out: TagNode[] = [];
    const walk = (nodes: TagNode[]) => nodes.forEach((n) => { out.push(n); walk(n.children); });
    walk(shown);
    return out;
  }, [shown]);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="标签分区">
      <TagsHeader
        flash={flash}
        mode={p.mode}
        onModeChange={p.onModeChange}
        filterOpen={filterOpen}
        onToggleFilter={() => setFilterOpen((v) => !v)}
        query={query}
        onQueryChange={setQuery}
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
          <p className="px-2 py-3 text-xs text-faint">还没有标签,在输入栏写 #标签 试试</p>
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
          />
        )}
        {visibleRows.length > 0 && filtering && shown.length === 0 && (
          <p className="px-2 py-2 text-xs text-faint">没有匹配的标签</p>
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
          x={menu.x}
          y={menu.y}
          tagRows={p.tagRows}
          onClose={() => setMenu(null)}
          onDone={onMenuDone}
        />
      )}
    </section>
  );
}
