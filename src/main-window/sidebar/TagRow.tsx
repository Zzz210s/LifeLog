/**
 * 标签树单行(spec 6.1):树模式按层级缩进 12px/级、带展开箭头与计数导轨;扁平模式不缩进、显示完整路径。
 * 选中态与条件对象同源(由上层派生传入);关系小字在 `TagRowRelationChips`。
 *
 * 单击行为(设计 2026-10-16 §4,2026-10-17 修订):onClick / onDoubleClick / onKeyDown 只做一件事 ——
 * 把「模式 + 修饰键 + 该行是否可选」交给 `rowIntent`(单击)/ `dblIntent`(双击),把结果派发回上层
 * (`onIntent`);条件补丁、预览卡片一概不在这里。单击与 Enter/Space 同义;预览卡片 = 双击
 * (`open` 档 + 可选行),单击只看这一条(2026-10-17 用户要求)。容器行(计数 0)恒 `expand`(§4.2),
 * 拖动起手的单击不派发(§4.3 第 16 行双保险),箭头自己 `stopPropagation` 只展开(第 13 行)。
 *
 * 标签名的行内 md(T1):显示位走 renderTagLabel(预览态),title / 其它字符串位走 tagLabelPlain;
 * data-tag-path 与所有回调仍传**原始路径**(语法不参与寻址)。
 *
 * 拖拽(2026-09-21 重做):真实标签行(id 非 null)draggable;整行 = 成为其子级(悬停整行高亮);
 * 同级插入线由 TagDropBand 画,本行只兜底画冒泡来的 before/after;拖拽中抑制 hover 高亮。
 */
import type { CSSProperties, ReactNode } from 'react';
import { renderTagLabel, tagLabelPlain } from '../../shared/tag-label';
import { hoverTitle } from '../../shared/truncate-title';
import type { RelationRef } from '../../shared/types';
import type { SidebarClickMode } from './click-mode';
import { dblIntent, modsOf, rowIntent, type ClickMods, type RowIntent } from './tag-row-action';
import { RowDropLine } from './TagDropBand';
import { guideWidth, lineIndent } from './tag-row-geometry';
import { TagRowRelationChips, rowRelationTips } from './TagRowRelationChips';
import type { TagNode } from './tag-tree';
import { isSelectable } from './tag-tree';
import type { DropZone } from './drag-check';

export interface TagRowProps {
  node: TagNode;
  /** 扁平模式:不缩进、无箭头、显示完整路径 */
  flat: boolean;
  selected: boolean;
  /** 已在排除侧:淡红底 + 「已排除」角标(点击 = 撤掉该排除,与选中态区分) */
  excluded: boolean;
  expanded: boolean;
  /** 当前单击模式(T4 接线;缺省 = filter,即旧的"单击 = 切换筛选"口径) */
  clickMode?: SidebarClickMode;
  /** open 的已打开行(§5.1):左缘竖条 + data-preview */
  previewing?: boolean;
  /** 行意图的唯一出口(单击 / 双击 / Enter / Space);条件与状态的一切执行都在上层 */
  onIntent: (intent: RowIntent, node: TagNode) => void;
  /** 多选(VS Code 口径,2026-10-25):`checked` 只决定高亮 —— 行本身不画勾选框;
   *  `onPick` 返回 true 表示"这次点击归选择"(Ctrl/Shift),不再走筛选意图 */
  selection?: { checked: boolean; onPick: (path: string, mods: { shift: boolean; ctrl: boolean }) => boolean };
  /** 展开 / 收起:箭头与 ArrowLeft/Right 用它,不占行意图 */
  onToggleExpand: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TagNode) => void;
  /** 拖拽:本行是拖动源 */
  dragSource: boolean;
  /** 拖拽:落点分区(child = 成为子级整行高亮;before/after = 冒泡来的同级指示线) */
  dropZone: DropZone | null;
  /** 拖拽进行中:抑制 hover 高亮(VS Code 的 .dragging 类口径) */
  dragActive: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  /** 本行标签的全部出边(A -> ?);悬浮卡片始终列,树行只在开关打开时显示前 2 条 */
  relations?: readonly RelationRef[];
  /** 设置开关「实体树里显示引用」:关时不进树行(悬浮卡片仍在) */
  showRelations?: boolean;
  onDragLeave: (e: React.DragEvent) => void;
}

const COUNT_RAIL_CLASS = 'ml-auto shrink-0 pl-2 text-label tabular-nums text-muted';
/** 光标 / 预览共用的左缘竖条(2px):绝对定位、不吃事件(§5.1) */
const BAR_CLASS = 'pointer-events-none absolute left-0 top-0 h-full w-0.5 bg-accent';

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
    (p.dropZone === 'child' ? ' bg-accent-soft' : '') +
    // 选中行:VS Code 那样整行底色(不画勾选框)。`bg-selected` 与"已在筛选中"的
    // `bg-accent-soft` 是两个档位,同时存在也分得清
    (p.selection?.checked ? ' bg-selected' : '');

  const tips = rowRelationTips(p.node.path, p.relations ?? []);

  /** 行意图的唯一出口(T4 接完线后必传):单击 / 双击 / Enter / Space 都派发到这里 */
  const emit = (intent: RowIntent): void => p.onIntent(intent, p.node);
  /** 行的"激活"= 模式 + 修饰键(修饰键优先,见 tag-row-action);拖过的不算单击(§4.3 第 16 行) */
  const activate = (m: ClickMods): void => {
    if (p.dragActive) return;
    // 选择层先看一眼:Ctrl = 加选、Shift = 连选(两者都不改筛选条件);
    // 无修饰键时它只更新选择集(单选),动作继续往下走(= VS Code 的"点一下既选中又打开")
    const consumed = p.selection?.onPick(p.node.path, { shift: m.shift, ctrl: m.ctrl }) ?? false;
    if (consumed) return;
    emit(rowIntent(p.clickMode ?? 'filter', m, selectable));
  };
  /** Enter/Space 与单击同义(显式处理并吃掉原生 click);ArrowLeft/Right 只在树模式动子树 */
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(modsOf(e));
      return;
    }
    if (p.flat || !hasChildren) return;
    if ((e.key === 'ArrowRight' && !p.expanded) || (e.key === 'ArrowLeft' && p.expanded)) {
      e.preventDefault();
      p.onToggleExpand(p.node.path);
    }
  };

  return (
    <button
      type="button"
      data-tag-path={p.node.path}
      data-drag-source={p.dragSource ? 'true' : undefined}
      data-drop-target={p.dropZone ?? undefined}
      draggable={p.node.id !== null}
      aria-pressed={selectable ? p.selected : undefined}
      aria-selected={p.selection?.checked === true ? 'true' : undefined}
      aria-expanded={p.previewing === true ? 'true' : undefined}
      aria-controls={p.previewing === true ? 'tag-preview-card' : undefined}
      data-preview={p.previewing === true ? 'true' : undefined}
      data-tip={tips.title}
      data-tip-rows={tips.rows}
      className={rowClass}
      style={
        {
          paddingLeft: lineIndent(p.node, p.flat),
          '--tag-guide': `${guideWidth(p.node.depth, p.flat)}px`,
        } as CSSProperties
      }
      onClick={(e) => activate(modsOf(e))}
      onDoubleClick={() => {
        // 双击:open 档 + 可选行 = 开预览卡片,其余 = 展开/收起;不读修饰键,
        // 也不等第二次点击(两次 click 的净效果见设计 §3.5)
        if (!p.dragActive) emit(dblIntent(p.clickMode ?? 'filter', selectable));
      }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => p.onContextMenu(e, p.node)}
      onDragStart={p.onDragStart}
      onDragEnd={p.onDragEnd}
      onDragOver={p.onDragOver}
      onDragLeave={p.onDragLeave}
      onDrop={p.onDrop}
    >
      {p.previewing === true && <span aria-hidden="true" data-row-bar className={BAR_CLASS} />}
      {/* 同级插入线:落点冒泡到整行时兜底画(几何与边界带同源),所以永远只有一条 */}
      {(p.dropZone === 'before' || p.dropZone === 'after') && (
        <RowDropLine zone={p.dropZone} left={lineIndent(p.node, p.flat)} />
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
      <span className="min-w-0 max-w-full shrink-0 truncate" onMouseEnter={hoverTitle(tagLabelPlain(label))}>
        {renderTagLabel(label)}
      </span>
      {p.excluded && (
        <span className="shrink-0 rounded-xs bg-danger-soft px-1 text-micro text-danger">已排除</span>
      )}
      <TagRowRelationChips relations={p.relations ?? []} show={p.showRelations === true} />
      <span className={COUNT_RAIL_CLASS} data-count-rail>
        {p.node.subtreeCount}
      </span>
    </button>
  );
}
