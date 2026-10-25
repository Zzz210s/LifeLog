/**
 * 侧栏选择的接线层(VS Code 口径,2026-10-25 第二版):把"哪份可见顺序 + 修饰键怎么翻成选择"
 * 只定义一处,`TagsSection` 只负责把它摊到行与浮条上。
 *
 * 修饰键 → 动作:
 * - 无        → `selectOnly`(替换为这一行)+ 照旧执行原有行意图(筛选 / 只看)
 * - Ctrl/Meta → `toggle`(加选/减选,不改条件)
 * - Shift     → `rangeTo`(锚点连选,不改条件)
 * Ctrl+A / Esc 由 hook 自己听键盘。
 */
import { useCallback, useMemo } from 'react';
import type { TagCount } from '../../shared/types';
import { flattenTree, type TagNode } from './tag-tree';
import { useTagSelection, type TagSelectionApi } from './use-tag-selection';

export interface SidebarSelection {
  selection: TagSelectionApi;
  /** 选中且仍可见的路径(浮条按它批量操作,顺序 = 可见顺序) */
  selectedPaths: string[];
  idByPath: Map<string, number>;
  /** 行的修饰键入口:返回 true 表示"这次点击已经归选择,不要再走筛选意图" */
  pick: (path: string, mods: { shift: boolean; ctrl: boolean }) => boolean;
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

  const pick = useCallback(
    (path: string, mods: { shift: boolean; ctrl: boolean }): boolean => {
      if (mods.shift) {
        selection.rangeTo(path);
        return true;
      }
      if (mods.ctrl) {
        selection.toggle(path);
        return true;
      }
      // 单击:替换选择集,但**不吞掉**原来的行意图(筛选 / 只看由上层继续执行)
      selection.selectOnly(path);
      return false;
    },
    [selection]
  );

  const selectedPaths = useMemo(() => {
    const set = selection.selected;
    return visiblePaths.filter((p) => set.has(p));
  }, [visiblePaths, selection.selected]);

  return { selection, selectedPaths, idByPath, pick };
}
