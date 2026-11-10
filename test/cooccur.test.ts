import { describe, expect, it } from 'vitest';
import { BLOCK_END, BLOCK_START, cooccurrence, neighborsOf, renderBlock, targetsOf, upsertBlock } from '../src/store/cooccur';
import { PointRecord } from '../src/store/schema';

const rec = (id: number, body: string, relations: { name: string; to: string }[] = []): PointRecord => ({
  path: `库/笔记/${id}.md`,
  id,
  createdAt: '2026-10-26T00:00:00',
  parent: null,
  relations,
  body,
});

describe('targetsOf', () => {
  it('标签、链接、关系目标都算实体，且去重', () => {
    const t = targetsOf(rec(1, '去了 #地点/印度 见 [[老张]] #地点/印度', [{ name: '国籍', to: '地点/日本' }]));
    expect(t.sort()).toEqual(['地点/印度', '地点/日本', '老张'].sort());
  });
});

describe('cooccurrence', () => {
  const records = [
    rec(1, '#地点/印度 #状态/未完成'),
    rec(2, '#地点/印度 #状态/未完成'),
    rec(3, '#地点/印度 #人物/老张'),
  ];

  it('权重 = 共同出现的笔记数，低于阈值被滤掉', () => {
    const pairs = cooccurrence(records, 2);
    expect(pairs).toEqual([{ a: '地点/印度', b: '状态/未完成', weight: 2 }]);
  });

  it('阈值调低后权重 1 的那一对也进来（状态与人物从未同篇，所以只有两条）', () => {
    expect(cooccurrence(records, 1).map((p) => p.weight)).toEqual([2, 1]);
  });

  it('顺序稳定（a < b，权重相同按字典序）', () => {
    const pairs = cooccurrence([rec(1, '#a #b #c')], 1);
    expect(pairs.map((p) => `${p.a}-${p.b}`)).toEqual(['a-b', 'a-c', 'b-c']);
  });

  it('neighborsOf 取一侧邻居并按权重排序', () => {
    const pairs = cooccurrence(records, 1);
    const n = neighborsOf(pairs, '地点/印度');
    expect(n.map((p) => p.weight)).toEqual([2, 1]);
  });
});

describe('受管区块', () => {
  it('渲染出 wiki 链接与权重注释', () => {
    const block = renderBlock([{ a: '地点/印度', b: '状态/未完成', weight: 3 }], '地点/印度');
    expect(block).toContain(`${BLOCK_START}`);
    expect(block).toContain('- [[状态/未完成]] <!-- w3 -->');
    expect(block).toContain(BLOCK_END);
  });

  it('upsert 幂等：重复写不会叠加', () => {
    const once = upsertBlock('正文', renderBlock([{ a: 'x', b: 'y', weight: 2 }], 'x'));
    const twice = upsertBlock(once, renderBlock([{ a: 'x', b: 'y', weight: 2 }], 'x'));
    expect(twice).toBe(once);
    expect(once.match(/共现/g)).toHaveLength(1);
  });

  it('已有区块会被整体替换', () => {
    const first = upsertBlock('正文', renderBlock([{ a: 'x', b: 'y', weight: 2 }], 'x'));
    const next = upsertBlock(first, renderBlock([{ a: 'x', b: 'z', weight: 5 }], 'x'));
    expect(next).toContain('[[z]]');
    expect(next).not.toContain('[[y]]');
  });
});
