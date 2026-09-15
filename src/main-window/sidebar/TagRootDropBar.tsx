/**
 * 标签分区拖拽的「移到根级」指示条(spec 6):拖拽期间常驻于分区底部,
 * 悬停分区空白(含本条)时高亮为蓝色,松手 = 移到根级。
 * 与列表容器的空白区共用同一组根级拖放事件(都代表"移到根级")。
 */
import type { ReactNode } from 'react';

export interface TagRootDropBarProps {
  /** 悬停在分区空白/本条上(高亮);false 时虚线灰样式 */
  overRoot: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function TagRootDropBar(p: TagRootDropBarProps): ReactNode {
  return (
    <div
      data-testid="tag-root-drop"
      onDragOver={p.onDragOver}
      onDrop={p.onDrop}
      className={
        'mx-1 mb-1 shrink-0 rounded border px-2 py-1 text-xs ' +
        (p.overRoot
          ? 'border-accent bg-accent-soft text-accent-text'
          : 'border-dashed border-border text-faint')
      }
    >
      移到根级
    </div>
  );
}
