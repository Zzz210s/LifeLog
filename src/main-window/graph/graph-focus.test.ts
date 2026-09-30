import { describe, expect, it } from 'vitest';
import type { GraphEdge } from '../../shared/types';
import { emphasisOf, isDimmed, neighborsOf } from './graph-focus';

const edges: GraphEdge[] = [
  { a: 1, b: 2, kind: 'tree', weight: 1 },
  { a: 2, b: 3, kind: 'co', weight: 5 },
  { a: 4, b: 5, kind: 'co', weight: 2 },
];

describe('邻居与强调', () => {
  it('1 跳邻居:父子与共现都算', () => {
    expect([...neighborsOf(edges, 2)].sort()).toEqual([1, 3]);
  });

  it('孤立节点没有邻居', () => {
    expect(neighborsOf(edges, 9).size).toBe(0);
  });

  it('悬停优先于选中:鼠标所在之处才是焦点', () => {
    // 选中 2 后悬停 4:焦点必须是 4 —— 否则光标正指着的 4 被画成 20% 透明、
    // 4 的邻居全暗,而气泡讲的是 4。「悬停高亮邻居」不能因存在选中而失效。
    const em = emphasisOf({ selected: 2, hovered: 4, edges });
    expect(em.active).toBe(4);
    expect([...em.neighbors]).toEqual([5]);
    expect(em.selected).toBe(2);
  });

  it('没有选中也没有悬停时,谁都不弱化', () => {
    const em = emphasisOf({ selected: null, hovered: null, edges });
    expect(em.active).toBe(null);
    expect(isDimmed(1, em)).toBe(false);
    expect(isDimmed(99, em)).toBe(false);
  });

  it('有 active 时:非邻居弱化,自己与邻居不弱化(无悬停则焦点=选中)', () => {
    const em = emphasisOf({ selected: 2, hovered: null, edges });
    expect(isDimmed(2, em)).toBe(false);
    expect(isDimmed(1, em)).toBe(false);
    expect(isDimmed(4, em)).toBe(true);
  });
});

// 自补:悬停单独生效(选中为空时)、选中与焦点解耦、邻居集合不吞掉 active 自己
describe('强调边界(自补)', () => {
  it('选中 A 悬停 B:A 不弱化、B 与其邻居不弱化、其余弱化', () => {
    const em = emphasisOf({ selected: 2, hovered: 4, edges });
    expect(isDimmed(2, em)).toBe(false); // 选中点带选中环,不因鼠标移开而暗掉
    expect(isDimmed(4, em)).toBe(false); // 焦点
    expect(isDimmed(5, em)).toBe(false); // 焦点邻居
    expect(isDimmed(1, em)).toBe(true);
    expect(isDimmed(3, em)).toBe(true);
  });
  it('没有选中时悬停生效', () => {
    const em = emphasisOf({ selected: null, hovered: 2, edges });
    expect(em.active).toBe(2);
    expect([...em.neighbors].sort()).toEqual([1, 3]);
    expect(isDimmed(4, em)).toBe(true);
  });

  it('只算 1 跳:邻居的邻居仍弱化', () => {
    const em = emphasisOf({ selected: 1, hovered: null, edges });
    expect([...em.neighbors]).toEqual([2]);
    expect(isDimmed(3, em)).toBe(true);
  });

  it('自环与双向重复边不重复,自己不被弱化', () => {
    const loops: GraphEdge[] = [
      { a: 7, b: 7, kind: 'co', weight: 1 },
      { a: 7, b: 8, kind: 'co', weight: 1 },
      { a: 8, b: 7, kind: 'co', weight: 1 },
    ];
    const em = emphasisOf({ selected: 7, hovered: null, edges: loops });
    expect([...em.neighbors]).toEqual([7, 8]);
    expect(isDimmed(7, em)).toBe(false);
    expect(isDimmed(8, em)).toBe(false);
  });
});
