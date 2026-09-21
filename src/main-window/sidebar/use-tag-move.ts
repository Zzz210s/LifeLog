/**
 * 拖拽落地的落库动作(自 use-tag-drag 拆出以守 200 行上限):
 * 整行 = move_tag(成为子级);边界带 = move_tag_beside(锚点 + after,同级插入);根级 = move_tag(id, null)。
 * busy 用一个 ref 守(拖拽落地是瞬时动作,不需要触发重渲);源记录在内存,不写 dataTransfer。
 */
import { useRef } from 'react';
import { api } from '../../shared/api';
import { findNode, parentPrefix } from './drag-resolve';
import type { DropTarget } from './drag-resolve';
import type { TagNode } from './tag-tree';

/** 被拖动的标签(源):drop 异步期间仍要用,所以存独立对象而不是直接存 TagNode */
export interface MoveSource {
  id: number;
  path: string;
  name: string;
}

export interface UseTagMoveArgs {
  /** 标签树(过滤后):找锚点 id 用 */
  roots: TagNode[];
  onMoved: (pathChange: { from: string; to: string }) => void;
  onError: (message: string) => void;
}

export function useTagMove(args: UseTagMoveArgs) {
  const busy = useRef(false);

  const run = (done: Promise<void>, from: string, to: string): void => {
    void done
      .then(() => args.onMoved({ from, to }))
      .catch((err) => args.onError(String(err)))
      .finally(() => {
        busy.current = false;
      });
  };

  /** 按落点执行移动:child = 成为其子级;before/after = 插到锚点行前/后(同级) */
  const move = (src: MoveSource, target: DropTarget): void => {
    if (busy.current) return;
    const anchor = findNode(args.roots, target.path);
    if (!anchor || anchor.id === null) return; // 锚点不在当前树里(并发刷新):静默跳过
    busy.current = true;
    const to = target.zone === 'child' ? target.path + '/' + src.name : parentPrefix(target.path) + src.name;
    const done =
      target.zone === 'child'
        ? api.moveTag(src.id, anchor.id)
        : api.moveTagBeside(src.id, anchor.id, target.zone === 'after');
    run(done, src.path, to);
  };

  /** 移到根级(调用方先确认源不在根级,T8) */
  const moveToRoot = (src: MoveSource): void => {
    if (busy.current) return;
    busy.current = true;
    run(api.moveTag(src.id, null), src.path, src.name);
  };

  return { move, moveToRoot };
}
