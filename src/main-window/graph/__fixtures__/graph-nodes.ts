// @vitest-environment node
/**
 * 关系图用例的共享点/相机夹具(架构精简 C2b,2026-10-27)。
 *
 * 原来七个 `graph-*.test.ts` 各写一份 `node()`,签名还不一样(1/2/3/4/5 参):
 * 想改一个默认值(depth / notes / sortOrder)要逐文件对齐。这里统一成 options 形状 ——
 * **默认值与改造前各自的取值一致**,所以既有断言不受影响。
 */
import type { GraphNode } from '../../../shared/types';

export interface NodeOpts {
  /** 默认取路径层级(`'a/b'` → 2),与原 graph-palette / graph-search 的写法一致 */
  depth?: number;
  parent?: number | null;
  /** 挂的笔记数;默认 1 */
  notes?: number;
  /** 本级笔记数;默认等于 `notes` */
  selfCount?: number;
  /** 排序键;默认 0 */
  sortOrder?: number;
}

/** `node(id, path)`;深度默认按路径段数推,其余按 options 覆盖 */
export function node(id: number, path: string, opts: NodeOpts = {}): GraphNode {
  const notes = opts.notes ?? 1;
  return {
    id,
    path,
    depth: opts.depth ?? path.split('/').length,
    parent: opts.parent ?? null,
    notes,
    selfCount: opts.selfCount ?? notes,
    sortOrder: opts.sortOrder ?? 0,
  };
}

/** 只给 id 的极简点(聚合用例用):路径固定 `a/<id>`、深度 0 */
export function bareNode(id: number): GraphNode {
  return { id, path: `a/${id}`, depth: 0, parent: null, notes: 1, selfCount: 1, sortOrder: id };
}

/** 相机:缩放 `k`、平移置零 */
export function camera(k: number): { k: number; tx: number; ty: number } {
  return { k, tx: 0, ty: 0 };
}
