/**
 * 逐帧不变件缓存的判别力用例(2026-10-06 性能轮)。
 *
 * 相机一动就重建整个 plan,而"节点 id -> 根轴名 / 笔记数 / 度数 / 轴色"只跟 `nodes`/`edges` 有关。
 * 缓存要同时满足两条相反的要求:
 * ① **同引用复用**(相机帧不重建 -> 省掉每帧的 Map 与令牌读数);
 * ② **换引用重建**(IPC 回新数据、过滤器换档后拿旧表就会画错)。
 * 只钉一条会漏掉两种错法中的一种:"永远复用一份"与"永远重建(缓存白写)"。
 *
 * 轴色还多一条:缓存键里必须带颜色口径(主题键)—— 亮暗切换后令牌值是新的,
 * 不能因为 `nodes` 没换就把旧色发出去。
 */
import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../../shared/types';
import { cachedNodeColors, edgeDegrees, nodeFacts } from './graph-plan-cache';

const node = (id: number, path: string, notes = 1): GraphNode => ({
  id, path, depth: 1, parent: null, notes, selfCount: notes, sortOrder: 0,
});

const NODES: GraphNode[] = [node(1, '时间/日期', 3), node(2, '时间/时刻', 1), node(3, '人物/作者', 5)];
const EDGES: GraphEdge[] = [
  { a: 1, b: 2, kind: 'co', weight: 1 },
  { a: 1, b: 3, kind: 'tree', weight: 1 },
];

describe('nodeFacts:同一个 nodes 引用只建一次表', () => {
  it('同引用两次取到同一个 Map(相机帧不重建)', () => {
    const a = nodeFacts(NODES);
    const b = nodeFacts(NODES);
    expect(b.axisOf).toBe(a.axisOf);
    expect(b.notesById).toBe(a.notesById);
  });

  it('换一个数组引用就重建,且内容跟着新数据(不能拿旧表)', () => {
    const a = nodeFacts(NODES);
    const next = [...NODES.slice(0, 2), node(3, '地点/城市', 9)];
    const b = nodeFacts(next);
    expect(b.axisOf).not.toBe(a.axisOf);
    expect(b.axisOf.get(3)).toBe('地点');
    expect(b.notesById.get(3)).toBe(9);
    expect(a.axisOf.get(3)).toBe('人物'); // 旧表不受影响
  });

  it('轴名取路径第一段,笔记数原样带上', () => {
    const f = nodeFacts([node(7, '时间/日期/2026', 4)]);
    expect(f.axisOf.get(7)).toBe('时间');
    expect(f.notesById.get(7)).toBe(4);
  });
});

describe('edgeDegrees:度数按 edges 引用缓存', () => {
  it('同引用复用、换引用重建,度数为父子边与共现边之和', () => {
    const a = edgeDegrees(EDGES);
    expect(edgeDegrees(EDGES)).toBe(a);
    expect(a.get(1)).toBe(2); // 两条边都连着 1
    expect(a.get(2)).toBe(1);
    const b = edgeDegrees([...EDGES, { a: 2, b: 3, kind: 'co', weight: 1 }]);
    expect(b).not.toBe(a);
    expect(b.get(3)).toBe(2);
  });
});

describe('cachedNodeColors:轴色表按 (nodes, 颜色口径) 缓存', () => {
  it('同一份节点 + 同一个主题键:令牌只读一次(相机每帧重建 plan 不再重读令牌)', () => {
    const nodes = [node(1, '时间/日期', 3), node(2, '人物/作者', 5)];
    let reads = 0;
    const read = (slot: number): string => { reads += 1; return `色${slot}`; };
    const a = cachedNodeColors(nodes, read, 'light');
    const first = reads; // 两个根轴(时间 / 人物)= 两次读数
    expect(first).toBe(2);
    const b = cachedNodeColors(nodes, read, 'light');
    expect(b).toBe(a);
    expect(reads).toBe(first); // 第二次一次都没读
    expect([...new Set(a.values())]).toHaveLength(2);
  });

  it('主题键一变(亮暗切换)必须重读令牌:不能因为 nodes 没换就把旧色发出去', () => {
    const nodes = [node(1, '时间/日期', 3)];
    const dark = cachedNodeColors(nodes, (slot) => `暗色${slot}`, 'dark');
    const light = cachedNodeColors(nodes, (slot) => `亮色${slot}`, 'light');
    expect(dark).not.toBe(light);
    expect([...light.values()]).toContain('亮色0');
  });
});
