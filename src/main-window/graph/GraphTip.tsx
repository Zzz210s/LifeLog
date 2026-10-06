/**
 * 关系图画布上的瞬时气泡(2026-10-06 卡片简化):悬停某个标签节点时给**简化版档案卡片** ——
 * 第一行是标签**末段名**(不带路径、不带计数),之后每条关系一行(左属性名 muted、右值)。
 * **没有关系的标签不出卡片**;计数只在侧栏行内保留(信息条另给计数)。
 *
 * 只做展示:命中检测在 `GraphView`(Task 5),气泡不吃指针(`TipBubble` 是 `pointer-events-none`);
 * 位置由调用方给屏幕坐标 —— 画布坐标要过相机换算,组件里算不了。
 */
import type { ReactNode } from 'react';
import type { GraphNode } from '../../shared/types';
import { tagFactsRows, tagLeafName, type RelationFactLike } from '../../shared/tag-relation-facts';
import { TipBubble } from '../shell/TipBubble';

export function GraphTip(p: {
  node: GraphNode | null;
  /** 该标签的出边(目标名 + 边上的属性名);空表 = 没关系的标签 -> 不出卡片(2b) */
  relations: readonly RelationFactLike[];
  x: number;
  y: number;
}): ReactNode {
  if (p.node === null) return null;
  const rows = tagFactsRows(p.relations);
  if (rows.length === 0) return null;
  return <TipBubble text={tagLeafName(p.node.path)} rows={rows} x={p.x} y={p.y} />;
}
