/**
 * 标签树拖拽状态与事件(spec 6 + 2026-09-21 重做):树/扁平两模式共用。
 * 源记录在内存 state(不用 dataTransfer.setData,防把标签路径文本拖给外部应用)。
 * 落点模型(T3/T4):整行 = 成为子级;相邻行之间的 12px 边界带对半 = 同级插入;
 * 无效目标(自身/子孙/结构节点)向父级冒泡,一路找不到或"原地不动"就不给任何反馈、不写库。
 * 落库动作在 use-tag-move.ts,自动滚动/重算落点/悬停自动展开在 drag-runtime.ts;
 * 拖拽图像、拖拽态兜底清理(T6)、100ms dragleave 防抖(T7)、根级 no-op(T8)在本文件。
 */
import { useEffect, useRef, useState } from 'react';
import { findNode, resolveDrop, sameTarget } from './drag-resolve';
import type { DropTarget } from './drag-resolve';
import type { DropZone } from './drag-check';
import { attachDragImage } from './drag-image';
import { useDragRuntime } from './drag-runtime';
import { useTagMove } from './use-tag-move';
import type { MoveSource } from './use-tag-move';
import type { TagNode } from './tag-tree';

export interface UseTagDragArgs {
  /** 移动成功:路径变化(旧完整路径 -> 新完整路径),上层提示并级联刷新 */
  onMoved: (pathChange: { from: string; to: string }) => void;
  /** 预校验失败或后端拒绝:中文提示 */
  onError: (message: string) => void;
  /** 标签树(过滤后):落点解析与冒泡要用层级;扁平模式的显示序不影响解析 */
  roots: TagNode[];
  /** 完整标签树(未过滤):只用于"原地不动"的同级序判定 —— 过滤隐藏行但不改变真实兄弟序 */
  orderRoots?: TagNode[];
  /** 展开判定与自动展开入口(T2;过滤态恒展开,故不会有自动展开) */
  expanded: (path: string) => boolean;
  onAutoExpand: (path: string) => void;
  /** 标签列表滚动容器(T1 自动滚动) */
  listRef: React.RefObject<HTMLDivElement | null>;
}

/** 悬停反馈的两个来源(T8:根级落点单独记) */
interface Hit {
  over: DropTarget | null;
  root: boolean;
}

const NO_HIT: Hit = { over: null, root: false };

export function useTagDrag(args: UseTagDragArgs) {
  const [source, setSource] = useState<MoveSource | null>(null);
  const [hit, setHit] = useState<Hit>(NO_HIT);
  const sourceRef = useRef<MoveSource | null>(null);
  const hitRef = useRef<Hit>(NO_HIT);
  const clearTimer = useRef<number | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const move = useTagMove({ roots: args.roots, onMoved: args.onMoved, onError: args.onError });
  const rt = useDragRuntime({
    listRef: args.listRef,
    active: () => sourceRef.current !== null,
    expanded: args.expanded,
    onAutoExpand: args.onAutoExpand,
  });

  /** 悬停反馈写回:feedback 未变直接早退(T7,不 setState) */
  const applyHit = (next: Hit): void => {
    const cur = hitRef.current;
    if (cur.root === next.root && sameTarget(cur.over, next.over)) return;
    hitRef.current = next;
    setHit(next);
  };

  const cancelClear = (): void => {
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
    clearTimer.current = null;
  };

  const hoverAt = (e: React.DragEvent, node: TagNode, zone: DropZone): void => {
    const src = sourceRef.current;
    if (!src) return;
    e.preventDefault();
    e.stopPropagation(); // 行/边界带一律抢占,不让容器把这次悬停当成"移到根级"
    cancelClear();
    rt.pointer(e);
    const target = resolveDrop(args.roots, src, { path: node.path, zone }, args.orderRoots);
    // 有效目标才设 move;无效目标不设 dropEffect(以"无高亮"为反馈,与 VS Code 一致)
    if (target) e.dataTransfer.dropEffect = 'move';
    rt.maybeAutoExpand(node);
    applyHit({ over: target, root: false });
  };

  /** 行/边界带离开:100ms 防抖后再清(T7;期间回到任一目标都会被取消) */
  const onDragLeave = (): void => {
    cancelClear();
    clearTimer.current = window.setTimeout(() => {
      clearTimer.current = null;
      rt.cancelAuto();
      applyHit(NO_HIT);
    }, 100);
  };

  const stopAll = (): void => {
    cancelClear();
    rt.reset();
    sourceRef.current = null;
    hitRef.current = NO_HIT;
    setSource(null);
    setHit(NO_HIT);
  };
  stopRef.current = stopAll;

  // 拖拽被打断(窗口 pointerup / 面板卸载)都要清拖拽态,不留残留热点(T6)
  useEffect(() => {
    if (source === null) return;
    const end = (): void => stopRef.current();
    window.addEventListener('pointerup', end);
    window.addEventListener('dragend', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('dragend', end);
    };
  }, [source]);
  useEffect(() => () => stopRef.current(), []);

  const onDragStartRow = (e: React.DragEvent, node: TagNode): void => {
    if (node.id === null) {
      e.preventDefault(); // 结构节点不可拖:draggable 已为 false,这里兜底合成事件
      return;
    }
    const src: MoveSource = { id: node.id, path: node.path, name: node.name };
    sourceRef.current = src;
    setSource(src);
    e.dataTransfer.effectAllowed = 'move';
    attachDragImage(e.dataTransfer, node.name);
    rt.pointer(e);
  };

  /** 行/边界带松手:先解析(冒泡 + 无变化判定),解析不出合法落点就静默(不写库、不回执) */
  const dropAt = (e: React.DragEvent, anchorPath: string, zone: DropZone): void => {
    const src = sourceRef.current;
    if (!src) return;
    e.preventDefault();
    e.stopPropagation();
    const target = resolveDrop(args.roots, src, { path: anchorPath, zone }, args.orderRoots);
    stopAll();
    if (target) move.move(src, target);
  };

  /** 分区空白/根级指示条悬停:非根级源才高亮「移到根级」(T8) */
  const onDragOverRoot = (e: React.DragEvent): void => {
    const src = sourceRef.current;
    if (!src) return;
    e.preventDefault();
    cancelClear();
    rt.cancelAuto();
    rt.pointer(e);
    applyHit({ over: null, root: src.path.includes('/') });
  };

  const onDropRoot = (e: React.DragEvent): void => {
    const src = sourceRef.current;
    if (!src) return;
    e.preventDefault();
    stopAll();
    if (src.path.includes('/')) move.moveToRoot(src); // 已在根级:零写入、零回执(T8)
  };

  /** 离开标签列表(仍在列表内移动不算离开):立即停自动滚动(T1) */
  const onDragLeaveList = (e: React.DragEvent): void => {
    const to = e.relatedTarget as Node | null;
    if (to && e.currentTarget.contains(to)) return;
    rt.reset();
  };

  return {
    /** 是否有标签拖拽进行中(源已记录) */
    dragging: source !== null,
    /** 拖动源行完整路径 */
    sourcePath: source?.path ?? null,
    /** 当前落点(已冒泡 + 已剔除"原地不动") */
    over: hit.over,
    /** 悬停在分区空白/根级指示条 */
    overRoot: hit.root,
    /** 源不在根级时才接受根级落点(T8:根级条只在这时为 true) */
    rootAllowed: source !== null && source.path.includes('/'),
    /** 清拖拽态(源行被卸载等兜底路径用,T6) */
    clearDrag: stopAll,
    rowEvents: {
      onDragStartRow,
      onDragEnd: stopAll,
      onDragOverRow: (e: React.DragEvent, node: TagNode) => hoverAt(e, node, 'child'),
      onDropRow: (e: React.DragEvent, node: TagNode) => dropAt(e, node.path, 'child'),
    },
    bandEvents: {
      onDragOverBand: (e: React.DragEvent, path: string, zone: 'before' | 'after') => {
        const node = findNode(args.roots, path);
        if (node) hoverAt(e, node, zone);
      },
      onDropBand: (e: React.DragEvent, path: string, zone: 'before' | 'after') => dropAt(e, path, zone),
      onDragLeaveBand: onDragLeave,
    },
    rootEvents: { onDragOverRoot, onDropRoot },
    listEvents: { onDragLeaveList },
  };
}
