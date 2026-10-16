/**
 * select 模式下侧栏底部的光标条(设计 2026-10-16 §5.3):显示当前光标实体的路径与两个计数,
 * 「只看这条实体」= 等价 Shift+单击(真正筛到流),「清除选中」= 清光标。
 * 是否渲染由上层决定(`clickMode === 'select' && cursorPath !== null && !dragging`);
 * 计数取 App 的 `tagRows`(self_count / subtree_count),零新 IPC。本组件纯 props,不持状态。
 */
import type { ReactNode } from 'react';
import { renderTagLabel } from '../../shared/tag-label';
import { hoverTitle } from '../../shared/truncate-title';
import { BTN_TEXT } from '../shell/button-classes';

export interface TagCursorBarProps {
  /** 光标实体的路径(纯文本,显示位走行内 md 预览态) */
  path: string;
  /** 本级条数 */
  selfCount: number;
  /** 含子级条数 */
  subtreeCount: number;
  /** 「只看这条实体」:等价 Shift+单击(上层筛到流) */
  onOnlyThis: () => void;
  /** 「清除选中」:清光标 */
  onClear: () => void;
}

export function TagCursorBar({ path, selfCount, subtreeCount, onOnlyThis, onClear }: TagCursorBarProps): ReactNode {
  return (
    <div
      data-testid="tag-cursor-bar"
      className="mx-1 mb-1 flex h-6 shrink-0 items-center gap-1 border-t border-border px-2 text-label text-muted"
    >
      <span className="shrink-0">实体：</span>
      <span className="min-w-0 flex-1 truncate text-text" onMouseEnter={hoverTitle(path)}>
        {renderTagLabel(path)}
      </span>
      <span className="shrink-0">
        本级 {selfCount} / 含子级 {subtreeCount}
      </span>
      <button type="button" aria-label="只看这条实体" className={BTN_TEXT + ' text-accent-text'} onClick={onOnlyThis}>
        只看这条
      </button>
      <button type="button" aria-label="清除选中" className={BTN_TEXT} onClick={onClear}>
        清除
      </button>
    </div>
  );
}
