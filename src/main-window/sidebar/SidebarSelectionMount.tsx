/**
 * 选择浮条的挂点(自 `TagsSection` 抽出,守 200 行红线)。
 * VS Code 口径:单选只是行高亮,不弹浮条;有 **2 行以上**选中才给批量操作。
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
  if (p.selection.count < 2) return null;
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
