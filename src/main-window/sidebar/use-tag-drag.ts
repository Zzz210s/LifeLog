/**
 * 标签树拖拽状态与事件(spec 6 + S8):树/扁平两模式共用。
 * 源记录在内存 state(不用 dataTransfer.setData,防把标签路径文本拖给外部应用)。
 * 行上悬停一律抢占(不冒泡到分区空白),有效目标才高亮;无效目标 dropEffect=none。
 * 落点分区(S8):上 25% = 插到该行之前、下 25% = 插到该行之后(同级)、
 * 中 50% = 成为其子级;同级插入走 move_tag_beside(后端由锚点派生父级并重写 sort_order)。
 * 拖到拖动源自己身上/前后 = 无操作(不提示、不写库)。
 * 松手先过 drag-check 预校验,失败就地中文提示;通过才调后端,
 * 成功走 onMoved(带 from/to 路径变化,上层级联刷新树与筛选条件),
 * 后端拒绝(同级重名等)透传中文错误到 onError。
 */
import { useState } from 'react';
import { api } from '../../shared/api';
import { checkDrop, dropZoneFor, rowRatio } from './drag-check';
import type { DropZone } from './drag-check';
import type { TagNode } from './tag-tree';

/** 拖动源:drop 异步期间仍要用,所以存独立对象而不是直接存 TagNode */
interface DragSource {
  id: number;
  path: string;
  name: string;
}

export interface UseTagDragArgs {
  /** 移动成功:路径变化(旧完整路径 -> 新完整路径),上层提示并级联刷新 */
  onMoved: (pathChange: { from: string; to: string }) => void;
  /** 预校验失败或后端拒绝:中文提示 */
  onError: (message: string) => void;
}

/** 锚点所在行的父级路径(根级为空串),用于推算同级插入后的新路径 */
function parentPrefix(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i + 1) : '';
}

export function useTagDrag(args: UseTagDragArgs) {
  const [source, setSource] = useState<DragSource | null>(null);
  const [overPath, setOverPath] = useState<string | null>(null);
  const [overZone, setOverZone] = useState<DropZone | null>(null);
  const [overRoot, setOverRoot] = useState(false);
  const [busy, setBusy] = useState(false);

  const clear = () => {
    setSource(null);
    setOverPath(null);
    setOverZone(null);
    setOverRoot(false);
  };

  /** 结构节点不可拖:draggable 已为 false,这里兜底(合成事件等异常路径) */
  const onDragStartRow = (e: React.DragEvent, node: TagNode) => {
    if (node.id === null) {
      e.preventDefault();
      return;
    }
    setSource({ id: node.id, path: node.path, name: node.name });
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragEnd = () => clear();

  const onDragOverRow = (e: React.DragEvent, node: TagNode) => {
    if (!source) return;
    e.preventDefault();
    e.stopPropagation();
    // 拖到自己身上/前后:不画指示线,松手也不做事
    if (node.path === source.path) {
      setOverPath(null);
      setOverZone(null);
      setOverRoot(false);
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const zone = dropZoneFor(rowRatio(e.clientY, rect.top, rect.height));
    const ok = checkDrop(source, node).ok;
    e.dataTransfer.dropEffect = ok ? 'move' : 'none';
    setOverRoot(false);
    setOverPath(ok ? node.path : null);
    setOverZone(ok ? zone : null);
  };

  /** 行上松手:预校验 -> 按落点分区走 move_tag(成为子级)/ move_tag_beside(同级插入) */
  const onDropRow = (e: React.DragEvent, node: TagNode) => {
    if (!source) return;
    e.preventDefault();
    e.stopPropagation();
    const src = source;
    const zone = overZone ?? 'child';
    const verdict = checkDrop(src, node);
    clear();
    if (src.path === node.path) return; // 拖到自己前后 = 无操作
    if (!verdict.ok) return args.onError(verdict.reason);
    if (node.id === null) return; // checkDrop 已拒结构节点,这里只为收窄类型
    if (busy) return;
    setBusy(true);
    const done = zone === 'child'
      ? api.moveTag(src.id, node.id)
      : api.moveTagBeside(src.id, node.id, zone === 'after');
    const to = zone === 'child' ? node.path + '/' + src.name : parentPrefix(node.path) + src.name;
    void done
      .then(() => args.onMoved({ from: src.path, to }))
      .catch((err) => args.onError(String(err)))
      .finally(() => setBusy(false));
  };

  /** 分区空白/根级指示条悬停:高亮「移到根级」 */
  const onDragOverRoot = (e: React.DragEvent) => {
    if (!source) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverPath(null);
    setOverZone(null);
    setOverRoot(true);
  };

  const onDropRoot = (e: React.DragEvent) => {
    if (!source) return;
    e.preventDefault();
    const src = source;
    clear();
    if (busy) return;
    setBusy(true);
    void api
      .moveTag(src.id, null)
      .then(() => args.onMoved({ from: src.path, to: src.name }))
      .catch((err) => args.onError(String(err)))
      .finally(() => setBusy(false));
  };

  return {
    /** 是否有标签拖拽进行中(源已记录) */
    dragging: source !== null,
    /** 拖动源行完整路径(该行半透明显示) */
    sourcePath: source?.path ?? null,
    /** 当前悬停的有效目标行路径 */
    overPath,
    /** 当前悬停的落点分区(上/下 = 同级插入,中 = 成为子级) */
    overZone,
    /** 悬停在分区空白/根级指示条(高亮「移到根级」) */
    overRoot,
    rowEvents: { onDragStartRow, onDragEnd, onDragOverRow, onDropRow },
    rootEvents: { onDragOverRoot, onDropRoot },
  };
}
