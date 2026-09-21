/**
 * 相邻两行之间的「同级插入」边界带(T3;仅拖拽进行中渲染,负外边距不占布局)。
 *
 * 背景:改前是行内上/下 25% 分区 + 12px 热区两套状态,同一落点会同时点亮两条错位的线,
 * 且下 25% 会漂成"下一可见行之前"(下一行是第一个子级时就深一级)。现在:
 * - 整行 = 成为子级(在 TagRow),本组件只负责同级插入;
 * - 12px 边界带**对半**:上半 = 插到上一行之后(按上一行层级)、下半 = 插到下一行之前(按下一行层级);
 * - 一次只画一条 1px 线,`top` 落在两行边界上,左端从锚点层级缩进画到右缘(有意偏离 VS Code 的全宽线)。
 *
 * 数据属性仍是 `data-gap-anchor` / `data-gap-zone` / `data-gap-active`(验收探针沿用它读落点)。
 */
/**
 * 相邻两行之间的「同级插入」边界带(T3;仅拖拽进行中渲染,负外边距不占布局)。
 *
 * 背景:改前是行内上/下 25% 分区 + 12px 热区两套状态,同一落点会同时点亮两条错位的线,
 * 且下 25% 会漂成"下一可见行之前"(下一行是第一个子级时就深一级)。现在:
 * - 整行 = 成为子级;本组件只提供同级插入的**命中区**,一次只命中一侧;
 * - 12px 边界带**对半**:上半 = 插到上一行之后(按上一行层级)、下半 = 插到下一行之前(按下一行层级);
 * - **插入线由行自己画**(TagRow 的 before/after:边界 y + 按该行层级缩进),
 *   所以 DOM 里永远只有一条线(消除了改前"两条错位线"的矛盾)。
 *
 * 数据属性仍是 `data-gap-anchor` / `data-gap-zone` / `data-gap-active`(验收探针沿用它读落点)。
 */
import type { ReactNode } from 'react';
import type { DropTarget } from './drag-resolve';

/** 边界带的一侧:锚点行 + 插入位置 */
export interface DropBandSide {
  path: string;
  zone: 'before' | 'after';
}

export interface TagDropBandProps {
  upper: DropBandSide | null;
  lower: DropBandSide | null;
  /** 当前落点(T4 冒泡后的结果);与某一侧完全一致时画线并标记 data-gap-active */
  active: DropTarget | null;
  onDragOver: (e: React.DragEvent, side: DropBandSide) => void;
  onDrop: (e: React.DragEvent, side: DropBandSide) => void;
  onDragLeave: (e: React.DragEvent) => void;
}

export function TagDropBand(p: TagDropBandProps): ReactNode {
  const isActive = (s: DropBandSide | null): boolean =>
    !!s && !!p.active && p.active.path === s.path && p.active.zone === s.zone;

  const half = (side: DropBandSide | null, cls: string): ReactNode =>
    side === null ? null : (
      <div
        data-gap-anchor={side.path}
        data-gap-zone={side.zone}
        data-gap-active={isActive(side) ? 'true' : undefined}
        onDragOver={(e) => p.onDragOver(e, side)}
        onDrop={(e) => p.onDrop(e, side)}
        className={'absolute inset-x-0 ' + cls}
      />
    );

  return (
    <div className="relative z-10 -my-1.5 h-3" onDragLeave={p.onDragLeave}>
      {half(p.upper, 'top-0 h-1/2')}
      {half(p.lower, 'bottom-0 h-1/2')}
    </div>
  );
}
