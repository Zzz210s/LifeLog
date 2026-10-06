/**
 * 标签关系边的数据口径(设计 §8 / Task 5):
 * ① `list_tag_facts` 的批量事实摊平成 `A -> B` 的边,备注取**被指向标签**的名字备注;
 * ② 出/入度按**子树**聚合(与信息条「含子孙」、既有出链/入链同一口径)——
 *    选根也要把子孙的边算上,只算本级会让骨架节点永远显示 0。
 */
import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../shared/types';
import type { TagFact } from '../../shared/tag-facts-types';
import { relationDegrees, relationEdges } from './graph-relations';

const facts: TagFact[] = [
  { tagId: 2, relations: [{ toTagId: 4, path: '地点轴/国籍', name: '国籍', remark: '国别' }] },
  { tagId: 5, relations: [{ toTagId: 4, path: '地点轴/国籍', name: '国籍', remark: '' }] },
];

const nodes: GraphNode[] = [
  { id: 1, path: '作者', depth: 1, parent: null, notes: 9, selfCount: 1, sortOrder: 0 },
  { id: 2, path: '作者/丸尾常喜', depth: 2, parent: 1, notes: 8, selfCount: 8, sortOrder: 0 },
  { id: 3, path: '地点轴', depth: 1, parent: null, notes: 9, selfCount: 1, sortOrder: 0 },
  { id: 4, path: '地点轴/国籍', depth: 2, parent: 3, notes: 8, selfCount: 8, sortOrder: 0 },
];

describe('relationEdges:事实摊平', () => {
  it('每条出边成一条 A -> B,备注原样带过来(缺失为空串)', () => {
    expect(relationEdges(facts)).toEqual([
      { a: 2, b: 4, remark: '国别' },
      { a: 5, b: 4, remark: '' },
    ]);
  });

  it('没有事实就是空数组(不编边)', () => {
    expect(relationEdges([])).toEqual([]);
  });
});

describe('relationDegrees:出/入度(含子孙聚合)', () => {
  const rel = relationEdges(facts);

  it('选根:子孙的边也算进去', () => {
    expect(relationDegrees(rel, nodes, 1)).toEqual({ outbound: 1, backlinks: 0 });
    expect(relationDegrees(rel, nodes, 3)).toEqual({ outbound: 0, backlinks: 2 });
  });

  it('选子标签:只算它自己的边', () => {
    expect(relationDegrees(rel, nodes, 2)).toEqual({ outbound: 1, backlinks: 0 });
    expect(relationDegrees(rel, nodes, 4)).toEqual({ outbound: 0, backlinks: 2 });
  });

  it('两端都在子树里时两数都涨(与既有出链/入链口径一致)', () => {
    const inside = [{ a: 2, b: 4, remark: '' }];
    expect(relationDegrees(inside, nodes, 3)).toEqual({ outbound: 0, backlinks: 1 });
    expect(relationDegrees([...inside, { a: 4, b: 4, remark: '' }], nodes, 3)).toEqual({
      outbound: 1,
      backlinks: 2,
    });
  });

  it('库里的标签不存在时两数都是 0(不抛)', () => {
    expect(relationDegrees(rel, nodes, 99)).toEqual({ outbound: 0, backlinks: 0 });
  });
});
