/**
 * 图上的标签右键菜单宿主(G2 Task 5,自 `GraphView` 拆出以守行数红线):
 * 把图节点适配成侧栏 `TagMenu` 要的形状,并把菜单落点钉进视口。
 *
 * `allNodes` 必须是**全部**图节点(不是折叠后的可见子集)—— 时间轴根下的标签也要能当移动/合并的目标。
 * 根上的 `data-graph-overlay` 让指针交互 hook 知道"这一坨不算画布"(点菜单不该先清掉选中);
 * 外层用 `contents` 不生成盒子,菜单是 `fixed` 定位,布局与画布尺寸都不受影响。
 */
import type { ReactNode } from 'react';
import type { TagMruSource } from '../../shared/tag-mru';
import type { GraphNode } from '../../shared/types';
import { TagMenu } from '../sidebar/TagMenu';
import { clampMenuPos, toManagedNode, toTagCount } from './graph-tag-menu';

export interface GraphTagMenuHostProps {
  /** 右键请求(节点 id + 事件落点);null 表示不开菜单 */
  at: { id: number; x: number; y: number } | null;
  allNodes: readonly GraphNode[];
  /** 固定标签 + 标签 MRU(上层透传):「携带…」候选与侧栏同一套三档排序 */
  tagMru?: TagMruSource | null;
  onClose: () => void;
  onDone: (message: string, pathChange?: { from: string; to: string }) => void;
}

export function GraphTagMenuHost(p: GraphTagMenuHostProps): ReactNode {
  const at = p.at;
  if (at === null) return null;
  const node = p.allNodes.find((n) => n.id === at.id);
  // 菜单开着时标签被合并掉(重拉数据后集合里没有它):就地不渲染,不留一个指向空节点的菜单
  if (node === undefined) return null;
  const pos = clampMenuPos(at.x, at.y, window.innerWidth, window.innerHeight);
  return (
    <div className="contents" data-graph-overlay>
      <TagMenu
        node={toManagedNode(node)}
        tagRows={p.allNodes.map(toTagCount)}
        tagMru={p.tagMru ?? null}
        x={pos.x}
        y={pos.y}
        onClose={p.onClose}
        onDone={p.onDone}
      />
    </div>
  );
}
