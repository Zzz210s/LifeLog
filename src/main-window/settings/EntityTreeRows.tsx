/**
 * 设置页「标签关系」分区顶部的两行(设计 2026-10-16 §6):实体树里显示关系 + 单击实体行的行为。
 * 两行各自的值与写入都由上层(同一份侧栏状态)透传 —— 本组件只并排渲染,不改 `TagTreeRelationRow`
 * 的 props 形状;把 4 行渲染压成 1 行,是为了让分区文件留在 200 行红线内。
 */
import type { ReactNode } from 'react';
import type { SidebarClickMode } from '../sidebar/click-mode';
import { TagTreeRelationRow } from './TagTreeRelationRow';
import { SidebarClickModeRow } from './SidebarClickModeRow';

export interface EntityTreeRowsProps {
  showRelations: boolean;
  onShowRelationsChange: (v: boolean) => void;
  clickMode: SidebarClickMode;
  onChangeClickMode: (m: SidebarClickMode) => void;
}

export function EntityTreeRows(p: EntityTreeRowsProps): ReactNode {
  return (
    <>
      <TagTreeRelationRow checked={p.showRelations} onChange={p.onShowRelationsChange} />
      <SidebarClickModeRow value={p.clickMode} onChange={p.onChangeClickMode} />
    </>
  );
}
