/**
 * 多选浮条的挂点(自 `TagsSection` 抽出,守 200 行红线):未开启多选时什么都不渲染,
 * 开启后交给 `TagSelectionBar`。抽出的是**接线**,视觉与文案仍只在 TagSelectionBar 一处。
 */
import type { ReactNode } from 'react';
import { TagSelectionBar } from './TagSelectionBar';
import type { TagSelectionApi } from './use-tag-selection';

export interface SidebarSelectionMountProps {
  selection: TagSelectionApi;
  selectedPaths: readonly string[];
  idByPath: ReadonlyMap<string, number>;
  onDeleted: () => void;
  onFlash: (message: string, tone?: 'ok' | 'error') => void;
}

export function SidebarSelectionMount(p: SidebarSelectionMountProps): ReactNode {
  if (!p.selection.active) return null;
  return (
    <TagSelectionBar
      count={p.selection.count}
      paths={p.selectedPaths}
      ids={p.idByPath}
      onClear={p.selection.clear}
      onDeleted={p.onDeleted}
      onFlash={p.onFlash}
    />
  );
}
