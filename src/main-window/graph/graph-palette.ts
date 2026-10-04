/**
 * 关系图的分类着色(2026-10-04 设计 D4):按**根轴**给节点上色。
 * 口径来自 ui-ux-pro-max 图表库的 "Node types: categorical colors"。
 *
 * 规则:
 *   - 每个节点取路径第一段作为根轴(`时间/日期/2026` -> `时间`);
 *   - 根轴按**名字排序**后依次拿 `--color-graph-1..8`,第 9 个起回绕;
 *   - 根轴自己也用同一色(它就是那一族的代表);
 *   - 颜色值一律由调用方从令牌读出(本模块只决定**用哪一档**,不碰色值)。
 */
import type { GraphNode } from '../../shared/types';

/** 分类色档数(与 theme.css 的 --color-graph-N 对应) */
export const GRAPH_COLOR_SLOTS = 8;

/** 取路径第一段(根轴名) */
export function rootAxisOf(path: string): string {
  const cut = path.indexOf('/');
  return cut < 0 ? path : path.slice(0, cut);
}

/**
 * 根轴 -> 色档下标(0..7)。
 *
 * 按**节点数降序**分配(2026-10-04 返工):色板顺序是「平静 -> 醒目」,
 * 所以最大的轴拿到最平静的色 —— 上一版按轴名排序,结果占一半节点的大轴拿到 muddy brown,
 * 整屏一片土色。同数量时按轴名排序,保证着色稳定(不随节点顺序抖动)。
 */
export function axisSlots(nodes: readonly GraphNode[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const n of nodes) {
    const axis = rootAxisOf(n.path);
    count.set(axis, (count.get(axis) ?? 0) + 1);
  }
  const axes = [...count.keys()].sort((a, b) => {
    const d = (count.get(b) ?? 0) - (count.get(a) ?? 0);
    return d !== 0 ? d : a.localeCompare(b, 'zh');
  });
  return new Map(axes.map((axis, i) => [axis, i % GRAPH_COLOR_SLOTS]));
}

/**
 * 节点 id -> 颜色(由 `read` 把色档换成实际令牌值)。
 * 空输入返回空表,调用方退回兜底色。
 */
export function nodeColors(
  nodes: readonly GraphNode[],
  read: (slot: number) => string,
): Map<number, string> {
  const slots = axisSlots(nodes);
  const cache = new Map<number, string>();
  const out = new Map<number, string>();
  for (const n of nodes) {
    const slot = slots.get(rootAxisOf(n.path));
    if (slot === undefined) continue;
    let color = cache.get(slot);
    if (color === undefined) {
      color = read(slot);
      cache.set(slot, color);
    }
    out.set(n.id, color);
  }
  return out;
}
