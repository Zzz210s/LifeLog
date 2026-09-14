/**
 * 侧栏「标签」分区(spec 6.1):树/扁平双模式 + 类型过滤 + 计数导轨 + 选中态。
 * 选中态与筛选栏 tags[] 是同一份条件对象(上层传入 conditions 派生);
 * 点击 = applyTagPick(含子级 true),再点 = 移除;右键打开 TagMenu 管理标签。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { TagCount } from '../../shared/types';
import { TagMenu } from './TagMenu';
import { TagRow } from './TagRow';
import { buildTree, filterTree, toggleTagPick } from './tag-tree';
import type { ManagedNode, TagNode } from './tag-tree';
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

const HEADER_BTN =
  'rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600';

export function TagsSection(p: TagsSectionProps): ReactNode {
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ node: ManagedNode; x: number; y: number } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  const tree = useMemo(() => buildTree(p.tagRows), [p.tagRows]);
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

  const showFlash = (text: string) => {
    setFlash(text);
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1500);
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
    if (node.id === null) return; // 结构节点(补出的父级)不可管理:不出菜单
    // 菜单宽 224px(w-56)、高最多 320px,钳制不超出视口
    setMenu({
      node: { ...node, id: node.id },
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

  // 扁平模式:树拉平为深度优先序列(保留过滤后的可见集合)
  const flatNodes = useMemo(() => {
    const out: TagNode[] = [];
    const walk = (nodes: TagNode[]) => nodes.forEach((n) => { out.push(n); walk(n.children); });
    walk(shown);
    return out;
  }, [shown]);

  const renderTree = (nodes: TagNode[]): ReactNode =>
    nodes.map((n) => (
      <Fragment key={n.path}>
        <TagRow
          node={n}
          flat={false}
          selected={activePaths.has(n.path)}
          excluded={excludedPaths.has(n.path)}
          expanded={isExpanded(n.path)}
          onToggle={onToggle}
          onToggleExpand={toggleExpand}
          onContextMenu={onContextMenu}
        />
        {n.children.length > 0 && isExpanded(n.path) && renderTree(n.children)}
      </Fragment>
    ));

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="标签分区">
      <div className="group flex h-8 shrink-0 items-center gap-1 px-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">标签</h2>
        {flash && <span className="truncate text-xs text-green-600">{flash}</span>}
        <span className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            title={p.mode === 'tree' ? '切换为扁平列表' : '切换为树形'}
            aria-label={p.mode === 'tree' ? '切换为扁平列表' : '切换为树形'}
            onClick={() => p.onModeChange(p.mode === 'tree' ? 'flat' : 'tree')}
            className={HEADER_BTN}
          >
            {p.mode === 'tree' ? '树' : '扁平'}
          </button>
          <button
            type="button"
            title="过滤标签"
            aria-label="过滤标签"
            onClick={() => setFilterOpen((v) => !v)}
            className={HEADER_BTN + (filterOpen ? ' bg-gray-200 text-gray-600' : '')}
          >
            过滤
          </button>
        </span>
      </div>
      {filterOpen && (
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入关键词过滤标签"
          aria-label="过滤标签"
          className="mx-2 mb-1 h-7 shrink-0 rounded border border-gray-300 px-2 text-xs outline-none focus:border-blue-500"
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2" data-testid="tag-list">
        {p.tagRows.length === 0 ? (
          <p className="px-2 py-3 text-xs text-gray-400">还没有标签,在输入栏写 #标签 试试</p>
        ) : p.mode === 'tree' ? (
          renderTree(shown)
        ) : (
          flatNodes.map((n) => (
            <TagRow
              key={n.path}
              node={n}
              flat
              selected={activePaths.has(n.path)}
              excluded={excludedPaths.has(n.path)}
              expanded={false}
              onToggle={onToggle}
              onToggleExpand={toggleExpand}
              onContextMenu={onContextMenu}
            />
          ))
        )}
        {p.tagRows.length > 0 && filtering && shown.length === 0 && (
          <p className="px-2 py-2 text-xs text-gray-400">没有匹配的标签</p>
        )}
      </div>
      {menu && (
        <TagMenu node={menu.node} x={menu.x} y={menu.y} tagRows={p.tagRows} onClose={() => setMenu(null)} onDone={onMenuDone} />
      )}
    </section>
  );
}
