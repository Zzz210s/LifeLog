/**
 * 拖拽落点解析(T3/T4/T7,纯函数):把"指针悬停的原始位置"收敛成唯一合法落点。
 * 与 VS Code 同构的部分:
 * - 整行 = 成为其子级(into);相邻行之间的 12px 边界带对半 = 同级插入(before/after)
 * - 无效目标(自身 / 自身子孙 / 结构节点)向父级冒泡(bubble: Up),一路找不到 -> null
 * - "同父级 + 同位"= 原地不动,同样返回 null(不显示反馈、不写库)
 * 与 VS Code 的差异(有意):VS Code 的插入线整行宽不缩进,我们按锚点层级缩进(见 fix-report)。
 */
import { checkDrop } from './drag-check';
import type { DropZone } from './drag-check';
import type { TagNode } from './tag-tree';

/** 落点:path = 锚点行完整路径,zone = child(成为其子级)/ before / after(同级插入) */
export interface DropTarget {
  path: string;
  zone: DropZone;
}

/** 拖拽源引用(checkDrop 只看 id 与 path) */
export interface DragSourceRef {
  id: number | null;
  path: string;
}

/** 父级路径(根级为空串):用于比较与查找 */
export function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

/** 父级前缀(根级为空串,否则以 / 结尾):用于拼新完整路径 */
export function parentPrefix(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i + 1) : '';
}

/** 两节点是否同级(同一父级) */
export function sameParent(a: string, b: string): boolean {
  return parentOf(a) === parentOf(b);
}

/** 树里按路径找节点(标签路径唯一) */
export function findNode(roots: TagNode[], path: string): TagNode | null {
  const walk = (nodes: TagNode[]): TagNode | null => {
    for (const n of nodes) {
      if (n.path === path) return n;
      const hit = walk(n.children);
      if (hit) return hit;
    }
    return null;
  };
  return walk(roots);
}

/** 同一父级下兄弟路径的显示序(与 buildTree 的 (sortOrder, path) 序同源) */
function siblingsOf(roots: TagNode[], path: string): string[] | null {
  const parent = parentOf(path);
  if (parent === '') return roots.map((n) => n.path);
  const parentNode = findNode(roots, parent);
  return parentNode ? parentNode.children.map((n) => n.path) : null;
}

/** 落点是否等价(用于 feedback 未变早退) */
export function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return a.path === b.path && a.zone === b.zone;
}

/**
 * 该落点是否"原地不动":插到自己紧邻的位置、或成为当前父级的子级(即右键移动已在此处)。
 * 判定与后端 apply_sibling_order 的口径一致(同级序 = sort_order 再 path):
 * 后端先把源从本层摘掉再插到锚点位置,所以"插到锚点之后(前)"等价于当前序里源就在锚点后(前)一位。
 */
export function isNoopDrop(roots: TagNode[], src: DragSourceRef, t: DropTarget): boolean {
  if (t.zone === 'child') return t.path === parentOf(src.path);
  if (!sameParent(src.path, t.path)) return false;
  const sibs = siblingsOf(roots, src.path);
  if (!sibs) return false;
  const i = sibs.indexOf(src.path);
  const j = sibs.indexOf(t.path);
  if (i < 0 || j < 0) return false;
  return t.zone === 'after' ? i === j + 1 : i === j - 1;
}

/** 边界带的一侧:锚点行 + 插入位置 */
export interface BandSideRef {
  path: string;
  zone: 'before' | 'after';
}

/**
 * 相邻两行之间边界带的两半(T3/T7):
 * 上半 = 插到上一行之后(按上一行层级)、下半 = 插到下一行之前(按下一行层级);
 * 同一父级时两者等价,上半归一化成下半(取一个,避免指针越过中线时视觉来回跳)。
 * 只有一行时对应的一半为 null(上半没有上一行 / 末尾带没有下一行)。
 */
export function bandHalves(
  prev: { path: string } | null,
  next: { path: string } | null
): { upper: BandSideRef | null; lower: BandSideRef | null } {
  const lower = next === null ? null : { path: next.path, zone: 'before' as const };
  if (prev === null) return { upper: null, lower };
  const between = next !== null && sameParent(prev.path, next.path);
  return { upper: between ? lower : { path: prev.path, zone: 'after' }, lower };
}

/**
 * 解析落点:目标不合法就向上找最近合法祖先(zone 保持不变,与 VS Code bubble: Up 一致);
 * 一路找不到、或解析结果是"原地不动" -> null(调用方据此不做任何反馈、不写库)。
 *
 * 同级序判定与命中/冒泡共用同一棵树(`roots`):侧栏过滤框已删,显示序就是真实序
 * (2/3 Task 5 把原 `orderRoots` 双参收成单参 —— 恒等路径,复审 I2 的过滤态场景随之消失)。
 */
export function resolveDrop(
  roots: TagNode[],
  src: DragSourceRef,
  hover: DropTarget
): DropTarget | null {
  if (src.id === null) return null;
  let node = findNode(roots, hover.path);
  while (node) {
    if (checkDrop(src, node).ok) {
      const t: DropTarget = { path: node.path, zone: hover.zone };
      return isNoopDrop(roots, src, t) ? null : t;
    }
    const parent = parentOf(node.path);
    node = parent === '' ? null : findNode(roots, parent);
  }
  return null;
}
