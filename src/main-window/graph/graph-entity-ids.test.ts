/**
 * 图数据前端分流:实体 id 没有区间含义(统一实体后全库连号),前端**必须按 `kind` / DTO 形状分流**,
 * 不能靠数值大小猜身份。这里的夹具用「大 id 当标签、小 id 当笔记」,并刻意让一条 `link` 边的两端
 * 数值恰好等于可见标签节点 id —— 哪天改成按数值区间分流,这些用例立刻变红。
 *
 * 两件不能退化的事:
 * ① 关系备注读**边上的** `remark`,不是被指向标签的名字(记忆 #1265/#1266);
 * ② `link` 边两端是笔记实体 id,不许混进标签边(拿它们过 `kept.has` 会污染力导向/计数)。
 */
import { describe, expect, it } from 'vitest';
import type { GraphData, GraphNode } from '../../shared/types';
import type { TagFact } from '../../shared/tag-facts-types';
import { applyFilters, defaultFilters } from './graph-filters';
import { relationEdges, relationRows } from './graph-relations';

/** 夹具里的「标签侧」id 基数:取值只为与笔记侧(个位数)在数值上拉开,无生产含义 */
const TAG = 1000;
const tagId = (legacy: number): number => TAG + legacy;

const node = (id: number, path: string, parent: number | null, depth: number): GraphNode => ({
  id,
  path,
  depth,
  parent,
  notes: 1,
  selfCount: 1,
  sortOrder: 0,
});

const nodes: GraphNode[] = [
  node(tagId(1), '作者', null, 1),
  node(tagId(2), '作者/鲁迅', tagId(1), 2),
  node(tagId(3), '地点轴', null, 1),
  node(tagId(4), '地点轴/国籍', tagId(3), 2),
];

/** `作者/鲁迅 --(国别)--> 地点轴/国籍`:备注(国别)与目标末段名(国籍)刻意不同 */
const facts: TagFact[] = [
  { tagId: tagId(2), relations: [{ toTagId: tagId(4), path: '地点轴/国籍', name: '国籍', remark: '国别' }] },
];

describe('关系边两端是标签实体 id', () => {
  it('relationEdges 原样带过标签实体 id(偏移区间)与边上的 remark', () => {
    expect(relationEdges(facts)).toEqual([{ a: tagId(2), b: tagId(4), remark: '国别' }]);
  });

  it('relationRows 按实体 id 找目标:值 = 目标末段名,备注 = 边上的 remark', () => {
    const rows = relationRows(relationEdges(facts), nodes, tagId(2));
    // 判别力:`国籍` 是目标末段名,`国别` 只在边上 —— 备注若改读目标名,这里立刻不等
    expect(rows).toEqual([{ name: '国籍', remark: '国别' }]);
  });

  it('目标不在可见节点里:不产出行(下拉不到的边没有可读的值)', () => {
    expect(relationRows(relationEdges(facts), nodes.filter((n) => n.id !== tagId(4)), tagId(2))).toEqual([]);
  });
});

describe('link 边按 kind 分流,不与标签实体混用', () => {
  // 笔记实体 id(不用偏移);即便某个数值恰好等于可见标签节点 id,也不许当标签边
  const data: GraphData = {
    nodes,
    edges: [
      { a: tagId(1), b: tagId(2), kind: 'tree', weight: 1 },
      { a: tagId(1), b: tagId(4), kind: 'co', weight: 3 },
      { a: 2, b: 8, kind: 'link', weight: 1 },
      // 两端数值都落在可见标签节点上:仍只能按 kind 落进 links,不许进标签边
      { a: tagId(1), b: tagId(3), kind: 'link', weight: 1 },
    ],
  };
  const f = defaultFilters(['作者', '地点轴'], []);

  it('tree/co 才与可见标签集比对;link 一律另归一列', () => {
    const { edges, links } = applyFilters(data, f);
    expect(edges.map((e) => e.kind)).toEqual(['tree', 'co']);
    expect(links).toEqual([
      { a: 2, b: 8 },
      { a: tagId(1), b: tagId(3) },
    ]);
  });

  it('一端不可见的标签边被丢掉,link 边不受影响', () => {
    const { edges, links } = applyFilters(data, { ...f, axes: ['作者'] });
    // 地点轴折叠:共现边的 tagId(4) 不可见 -> 丢;父子边两端都在 -> 留
    expect(edges).toEqual([{ a: tagId(1), b: tagId(2), kind: 'tree', weight: 1 }]);
    expect(links).toHaveLength(2);
  });
});
