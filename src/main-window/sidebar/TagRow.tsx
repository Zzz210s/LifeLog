/**
 * 标签树单行(spec 6.1 标签分区):树模式按层级缩进 12px/级、带展开箭头与计数导轨;
 * 扁平模式不缩进、显示完整路径。选中态与条件对象同源(由上层派生传入)。
 * 结构节点(含子级计数 0)只可展开不可选,行点击交给 onToggleExpand。
 *
 * 标签名的行内 md(T1):显示位走 renderTagLabel(预览态),title / 其它字符串位走 tagLabelPlain;
 * data-tag-path 与所有回调仍传**原始路径**(语法不参与寻址)。
 *
 * 拖拽(T3/T5,2026-09-21 重做):真实标签行(id 非 null)draggable;
 * - **整行 = 成为其子级**:悬停即整行背景高亮(主题 token,无边框/色带);
 * - 同级插入的 1px 指示线由 TagDropBand 画;本行只兜底画"冒泡到这里"的同级线(before/after),
 *   几何与边界带完全一致(边界 y + 按层级缩进),所以即使两者同时命中也是同一条线;
 * - 源行不再改透明度(VS Code 源行没有任何半透明处理),拖拽中抑制 hover 高亮。
 */
import type { CSSProperties, ReactNode } from 'react';
import {
  relationPlan,
  relationValue,
  relationValueTip,
  tagFactsRows,
  tagLeafName,
  uniqueRelationValues,
} from '../../shared/tag-relation-facts';
import { renderTagLabel, tagLabelPlain } from '../../shared/tag-label';
import { hoverTitle } from '../../shared/truncate-title';
import type { TagNode } from './tag-tree';
import { isSelectable } from './tag-tree';
import type { RelationRef } from '../../shared/types';
import type { DropZone } from './drag-check';

export interface TagRowProps {
  node: TagNode;
  /** 扁平模式:不缩进、无箭头、显示完整路径 */
  flat: boolean;
  selected: boolean;
  /** 已在排除侧:淡红底 + 「已排除」角标(点击 = 撤掉该排除,与选中态区分) */
  excluded: boolean;
  expanded: boolean;
  /** 行点击(可选中时 = 加入/移出筛选) */
  onToggle: (node: TagNode) => void;
  onToggleExpand: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TagNode) => void;
  /** 拖拽:本行是拖动源 */
  dragSource: boolean;
  /** 拖拽:本行的落点分区(child = 成为子级整行高亮;before/after = 冒泡来的同级指示线) */
  dropZone: DropZone | null;
  /** 拖拽进行中:抑制 hover 高亮(VS Code 的 .dragging 类口径) */
  dragActive: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  /** 本行标签的全部出边(A -> ?);悬浮卡片始终列,tree 行只在开关打开时显示前 2 条 */
  relations?: readonly RelationRef[];
  /** 设置开关「标签树里显示关系」:关时不进树行(悬浮卡片仍在) */
  showRelations?: boolean;
  /** 行离开(100ms 防抖清落点的入口) */
  onDragLeave: (e: React.DragEvent) => void;
}

const COUNT_RAIL_CLASS = 'ml-auto shrink-0 pl-2 text-label tabular-nums text-muted';

/** 行的左内边距 = 同级插入线的左端(扁平 6、树 6 + (depth-1)*12),两处必须同源 */
export function lineIndent(node: TagNode, flat: boolean): number {
  return flat ? 6 : 6 + (node.depth - 1) * 12;
}

/**
 * 缩进导轨宽度(视觉刷新 V5,设计 §4-8):每级 1px 竖线画在缩进区内(x = 6 + k*12)。
 * 第 2 层起每多一层多一条线,宽度 = 最后一条线的位置相对首条线的偏移 + 1px(首条在缩进区起点)。
 * main.css 的 .tag-guides 用这个宽度裁切那条 repeating-linear-gradient,因此不需要额外 DOM 节点。
 */
export function guideWidth(depth: number, flat: boolean): number {
  return flat || depth < 2 ? 0 : 1 + (depth - 2) * 12;
}

export function TagRow(p: TagRowProps): ReactNode {
  const selectable = isSelectable(p.node);
  const hasChildren = p.node.children.length > 0;
  const label = p.flat ? p.node.path : p.node.name;
  const state = p.excluded
    ? 'bg-danger-soft text-danger hover:bg-danger/20'
    : p.selected
      ? 'bg-selected text-accent-text'
      : p.dragActive
        ? 'text-muted'
        : 'text-muted hover:bg-hover hover:text-text';
  const rowClass =
    'tag-guides group relative flex w-full items-center gap-1 rounded-xs px-1.5 py-1 pr-2 text-left text-ui transition-colors ' +
    (selectable ? state : 'cursor-default text-muted' + (p.dragActive ? '' : ' hover:bg-hover')) +
    (p.dropZone === 'child' ? ' bg-accent-soft' : '');

  const relations = p.relations ?? [];
  /** 行内按值去重后再截断(同值多属性只占一个小字位;卡片里不去重,另走 factRows) */
  const relationChips = relationPlan(uniqueRelationValues(relations));
  const factRows = tagFactsRows(relations);
  // 只有带关系的标签才出卡片:没有关系就不挂 data-tip(名字被截断时仍由名字块的原生 title 兜底)
  const factsTitle = factRows.length > 0 ? tagLeafName(p.node.path) : undefined;

  return (
    <button
      type="button"
      data-tag-path={p.node.path}
      data-drag-source={p.dragSource ? 'true' : undefined}
      data-drop-target={p.dropZone ?? undefined}
      draggable={p.node.id !== null}
      aria-pressed={selectable ? p.selected : undefined}
      data-tip={factsTitle}
      data-tip-rows={factRows.length > 0 ? JSON.stringify(factRows) : undefined}
      className={rowClass}
      style={
        {
          paddingLeft: lineIndent(p.node, p.flat),
          '--tag-guide': `${guideWidth(p.node.depth, p.flat)}px`,
        } as CSSProperties
      }
      onClick={() => (selectable ? p.onToggle(p.node) : hasChildren && p.onToggleExpand(p.node.path))}
      onContextMenu={(e) => p.onContextMenu(e, p.node)}
      onDragStart={p.onDragStart}
      onDragEnd={p.onDragEnd}
      onDragOver={p.onDragOver}
      onDragLeave={p.onDragLeave}
      onDrop={p.onDrop}
    >
      {p.dropZone === 'before' && (
        <span
          aria-hidden="true"
          data-drop-line="before"
          className="pointer-events-none absolute right-0 top-0 h-px bg-accent"
          style={{ left: lineIndent(p.node, p.flat) }}
        />
      )}
      {p.dropZone === 'after' && (
        <span
          aria-hidden="true"
          data-drop-line="after"
          className="pointer-events-none absolute bottom-0 right-0 h-px bg-accent"
          style={{ left: lineIndent(p.node, p.flat) }}
        />
      )}
      {!p.flat && hasChildren && (
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={'w-3 h-3 shrink-0 text-muted transition-transform ' + (p.expanded ? 'rotate-90' : '')}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleExpand(p.node.path);
          }}
        >
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
      {!p.flat && !hasChildren && <span className="w-3 shrink-0" />}
      {/* 名字优先(2026-10-06 B 方案):名字不参与收缩(shrink-0),关系小字让位。
          max-w-full 只在「名字本身就比整行宽」时才截断(有省略号 + 悬停全文),杜绝静默裁切。 */}
      <span
        className="min-w-0 max-w-full shrink-0 truncate"
        onMouseEnter={hoverTitle(tagLabelPlain(label))}
      >
        {renderTagLabel(label)}
      </span>
      {p.excluded && (
        <span className="shrink-0 rounded-xs bg-danger-soft px-1 text-micro text-danger">已排除</span>
      )}
      {/* 关系小字紧跟标签名(离名字最近),计数导轨留行尾(ml-auto 仍把它推到最右)。
          小字只显示**值**(目标标签名),属性名降级到悬停 data-tip(信息位常给,不依赖截断);
          小字可收缩(min-w-0 + shrink)并封顶 8rem:宽度不够时先由它省略,名字保持完整。 */}
      {p.showRelations === true &&
        relationChips.shown.map((r, i) => {
          const value = relationValue(r);
          const tip = relationValueTip(r);
          return (
            <span
              key={`${r.toTagId}-${i}`}
              data-tag-relation
              data-tip={tip === '' ? undefined : tip}
              className="min-w-0 max-w-[8rem] shrink truncate rounded-xs bg-tag px-1 text-micro text-muted"
              onMouseEnter={hoverTitle(value)}
            >
              {value}
            </span>
          );
        })}
      {p.showRelations === true && relationChips.extra > 0 && (
        <span data-tag-relation className="shrink-0 text-micro text-muted">
          {'+' + relationChips.extra}
        </span>
      )}
      <span className={COUNT_RAIL_CLASS} data-count-rail>
        {p.node.subtreeCount}
      </span>
    </button>
  );
}
