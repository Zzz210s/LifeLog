/**
 * 位置记忆(`graph_positions`)的纯函数:G1 把这套逻辑放在 `use-graph-camera` 里,
 * G3 抽出来 —— 拖节点(use-node-drag)也要读/合并/修剪,两处共读一份,别在测试或验收探针里抄第二份。
 *
 * 两个口径:**存储层**是 `{"<标签 id>":{x,y}}` 的 JSON 对象(**世界坐标**),**绘制层**吃 `Map<number, Point>`。
 * 只有被拖过的节点才有条目(设计 §5),所以叠加上去是"覆盖"而不是"重建"。
 * 脏值一律丢:坏 JSON、数组、非有限坐标、缺字段、id 不是整数 —— 一个坏条目不该让整图落不了位。
 */
import type { Point } from './radial';

/** 存储层口径:标签 id 的字符串键 -> 世界坐标 */
export type Positions = Record<string, Point>;

/** "没有位置记忆"的空表(引用恒定):叠加上去时原样返回落点,下游 memo 不白重建 */
export const NO_POSITIONS: Positions = {};

export function parsePositions(raw: string | null): Positions {
  const out: Positions = {};
  if (raw === null || raw.trim() === '') return out;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return out;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const id = Number(key);
    const p = value as { x?: unknown; y?: unknown } | null;
    if (!Number.isInteger(id) || typeof p?.x !== 'number' || typeof p.y !== 'number') continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    out[key] = { x: p.x, y: p.y };
  }
  return out;
}

export function serializePositions(p: Positions): string {
  return JSON.stringify(p);
}

/** 修剪:只保留仍存在的标签 id(库里已删的标签不再占条目,写回时顺手清掉) */
export function prunePositions(p: Positions, validIds: Set<number>): Positions {
  const out: Positions = {};
  for (const [key, point] of Object.entries(p)) if (validIds.has(Number(key))) out[key] = point;
  return out;
}

/**
 * 叠加:记忆位置只覆盖"已被拖过、且这次布局里存在"的节点;不改原 Map。
 * 没有任何记忆时**原样返回**落点(Map 身份不变 -> 下游 plan 的 memo 不白重建)。
 */
export function applyPositions(points: Map<number, Point>, saved: Positions): Map<number, Point> {
  const ids = Object.keys(saved);
  if (ids.length === 0) return points;
  const out = new Map(points);
  for (const key of ids) {
    const id = Number(key);
    if (out.has(id)) out.set(id, saved[key]);
  }
  return out;
}
