/**
 * 同级插入的边界热区(仅拖拽进行中渲染)。
 *
 * 背景(用户反馈 2026-09-19):行内落点分区是"上/下 25% = 同级插入",但树行只有约 22px 高,
 * 25% ≈ 5.5px —— 真实鼠标几乎命中不了,手感就是"只能放成子级"。这里在相邻两行之间叠一条
 * 12px 高的透明热区(负外边距上下各借 6px),因此**完全不改变布局**,却把同级插入的命中区
 * 从 5.5px 变成 12px 的连续带;悬停时在边界处画出插入线,线的左端按锚点行的缩进对齐,
 * 让"插到哪一级"一眼可见。
 *
 * 与后端约定:zone='before' 表示插到这个锚点行之前(同级),'after' 表示之后;两者落在同一个
 * 边界上,视觉与语义一致(同一条插入线)。
 */
import type { ReactNode } from 'react';

export interface TagGapDropProps {
  /** 锚点行完整路径 */
  path: string;
  /** 相对锚点行的插入位置 */
  zone: 'before' | 'after';
  /** 当前悬停在这条热区上(画出插入线) */
  active: boolean;
  /** 插入线左端偏移(CSS px):跟随锚点行缩进,树模式按层级对齐、扁平模式为 0 */
  lineLeft: number;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function TagGapDrop(p: TagGapDropProps): ReactNode {
  return (
    <div
      data-gap-anchor={p.path}
      data-gap-zone={p.zone}
      data-gap-active={p.active ? 'true' : undefined}
      onDragOver={p.onDragOver}
      onDrop={p.onDrop}
      className="relative z-10 -my-1.5 h-3"
    >
      {p.active && (
        <span
          aria-hidden="true"
          className="absolute right-0 top-1/2 h-[2px] -translate-y-1/2 bg-accent"
          style={{ left: p.lineLeft }}
        />
      )}
    </div>
  );
}
