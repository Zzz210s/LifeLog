/**
 * 关系图右侧信息条(G2 Task 4):选中的标签详情与两个动作。
 *
 * 计数口径与画布气泡同源 —— `selfCount` 是**本级**去重笔记数,`notes` 是**含子孙**的
 * (`GraphNode` 注释),两个数一起给才不会把「414 篇」误读成这个标签自己挂了 414 篇。
 * 长路径 `break-all`:标签路径没有空格,`break-words` 断不开,会撑破 240px 的条子。
 * 「Esc 返回信息流」是纯提示,按键本身在 `GraphView` 的 window keydown 上。
 * 根上的 `data-graph-overlay` 告诉指针交互 hook:这一坨的事件不算画布交互(点按钮不该先把选中清掉)。
 */
import type { ReactNode } from 'react';
import type { GraphNode } from '../../shared/types';
import { BTN_SECONDARY } from '../shell/button-classes';

export function GraphInfoBar(p: {
  node: GraphNode;
  onFilterToStream: () => void;
  onToggleExpand: () => void;
  expanded: boolean;
}): ReactNode {
  const n = p.node;
  return (
    <div
      data-testid="graph-info-bar"
      data-graph-overlay
      className="absolute right-3 top-3 z-10 w-60 rounded-md border border-border bg-raised px-3 py-2 text-xs shadow-lg"
    >
      <div className="break-all font-medium text-text">{n.path}</div>
      <div className="mt-1 text-muted">
        本级 {n.selfCount} · 含子级 {n.notes}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={BTN_SECONDARY} onClick={p.onFilterToStream}>
          筛到信息流
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={p.onToggleExpand}>
          {p.expanded ? '收起笔记' : '展开笔记'}
        </button>
      </div>
      <div className="mt-2 text-muted">Esc 返回信息流</div>
    </div>
  );
}
