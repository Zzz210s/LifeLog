/**
 * 关系图画布上的瞬时气泡(G2 Task 4):悬停某个标签节点时显示「路径 · 本级 N / 含子级 M」。
 *
 * 只做展示:命中检测在 `GraphView`(Task 5),气泡不吃指针(`TipBubble` 是 `pointer-events-none`);
 * 位置由调用方给屏幕坐标 —— 画布坐标要过相机换算,组件里算不了。
 */
import type { ReactNode } from 'react';
import type { GraphNode } from '../../shared/types';
import { TipBubble } from '../shell/TipBubble';

export function GraphTip(p: { node: GraphNode | null; x: number; y: number }): ReactNode {
  if (p.node === null) return null;
  const n = p.node;
  return (
    <TipBubble text={`${n.path} · 本级 ${n.selfCount} / 含子级 ${n.notes}`} x={p.x} y={p.y} />
  );
}
