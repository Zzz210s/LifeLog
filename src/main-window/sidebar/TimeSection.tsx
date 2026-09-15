/**
 * 侧栏「时间」分区(spec 4.5):时间排序 -> 年 -> 月 -> 日,计数取子树计数,
 * 点击一行 = 按该时段筛选(tags[{path, includeChildren:true}],与标签分区共用条件对象与选中态)。
 * 默认展开、可折叠(折叠状态落设置键 time_section_open);库中无时间标签时整段隐藏。
 * 时间标签由系统维护:行不可拖拽、不作拖拽目标、右键不出管理菜单。
 */
import { Fragment, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { TagCount } from '../../shared/types';
import { TimeRow } from './TimeRow';
import { buildTimeTree } from './time-tree';
import { toggleTagPick } from './tag-tree';
import type { TagNode } from './tag-tree';
import { useTimeSection } from './use-time-section';

export interface TimeSectionProps {
  conditions: FilterConditions;
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 全量标签行(list_tags,含 id);本分区只取时间子树 */
  tagRows: TagCount[];
}

export function TimeSection(p: TimeSectionProps): ReactNode {
  const { open, setOpen } = useTimeSection();
  // 内部层级的展开态(不持久化,默认全展开;分区本身的折叠态才落库)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTimeTree(p.tagRows), [p.tagRows]);
  const activePaths = useMemo(() => new Set(p.conditions.tags.map((t) => t.path)), [p.conditions.tags]);
  const excludedPaths = useMemo(
    () => new Set(p.conditions.excludeTags.map((t) => t.path)),
    [p.conditions.excludeTags]
  );

  const toggleExpand = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const onPick = useCallback((path: string) => p.onPatch(toggleTagPick(p.conditions, path)), [p]);

  const renderTree = (nodes: TagNode[]): ReactNode =>
    nodes.map((n) => (
      <Fragment key={n.path}>
        <TimeRow
          node={n}
          selected={activePaths.has(n.path)}
          excluded={excludedPaths.has(n.path)}
          expanded={!collapsed.has(n.path)}
          onPick={onPick}
          onToggleExpand={toggleExpand}
        />
        {n.children.length > 0 && !collapsed.has(n.path) && renderTree(n.children)}
      </Fragment>
    ));

  // 无时间标签:整段隐藏,不显示空壳
  if (tree.length === 0) return null;

  return (
    <section className="shrink-0 border-b border-border pb-2" aria-label="时间分区">
      <div className="flex h-8 items-center px-2">
        <button
          type="button"
          data-testid="time-section-toggle"
          aria-expanded={open}
          title={open ? '折叠时间' : '展开时间'}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-faint hover:bg-text/10 hover:text-muted"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className={'w-3 h-3 transition-transform ' + (open ? 'rotate-90' : '')}
          >
            <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">时间</h2>
        </button>
      </div>
      {open && (
        <div data-testid="time-list" className="max-h-56 overflow-y-auto px-1">
          {renderTree(tree)}
        </div>
      )}
    </section>
  );
}
