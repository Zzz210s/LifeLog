/**
 * 侧栏多选的接线层(自 `TagsSection` 抽出,守 200 行红线 + 让"选中态用哪份可见顺序"
 * 只有一处定义)。
 *
 * 可见顺序的取法:树形 = 折叠后的 `shown` 深度优先序;扁平 = `flatNodes`(本身就是序列)。
 * Shift 连选、Ctrl+A 全选、浮条的"选中路径"都读同一份 `visiblePaths` —— 三处不一致
 * 就会出现"全选了却删不到"这类假成功。
 */
import { useMemo } from 'react';
import type { TagCount } from '../../shared/types';
import { flattenTree, type TagNode } from './tag-tree';
import { useTagSelection, type TagSelectionApi } from './use-tag-selection';

export interface SidebarSelection {
  selection: TagSelectionApi;
  visiblePaths: string[];
  /** 选中且仍可见的路径(浮条按它批量操作) */
  selectedPaths: string[];
  idByPath: Map<string, number>;
}

export function useSidebarSelection(
  rows: readonly TagCount[],
  mode: 'tree' | 'flat',
  shown: TagNode[],
  flatNodes: TagNode[]
): SidebarSelection {
  const visiblePaths = useMemo(
    () => (mode === 'tree' ? flattenTree(shown) : flatNodes).map((n) => n.path),
    [mode, shown, flatNodes]
  );
  const selection = useTagSelection(visiblePaths);
  const idByPath = useMemo(() => new Map(rows.map((r) => [r.path, r.id] as const)), [rows]);
  const selectedPaths = useMemo(
    () => visiblePaths.filter((path) => selection.selected.has(path)),
    [visiblePaths, selection.selected]
  );
  return { selection, visiblePaths, selectedPaths, idByPath };
}
