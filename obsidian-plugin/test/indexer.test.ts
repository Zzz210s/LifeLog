import { describe, expect, it } from 'vitest';
import { buildIndex, pathOf } from '../src/store/indexer';
import { PointRecord } from '../src/store/schema';

const rec = (path: string, id: number, parent: string | null, body = ''): PointRecord => ({
  path,
  id,
  createdAt: '2026-10-26T12:00:00',
  parent,
  relations: [],
  body,
});

describe('buildIndex', () => {
  const records = [
    rec('库/实体/地点.md', 1, null),
    rec('库/实体/地点/印度.md', 2, '库/实体/地点.md'),
    rec('库/实体/地点/印度/尼西亚.md', 3, '库/实体/地点/印度.md'),
    rec('库/笔记/2026/10/9-a.md', 9, null, '去过 #地点/印度 [[b]]'),
    rec('库/笔记/2026/10/10-b.md', 10, null, '还是 #地点/印度'),
  ];
  const index = buildIndex(records);

  it('实体与笔记分开归类', () => {
    expect(index.entities.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(index.notes.map((n) => n.id)).toEqual([9, 10]);
  });

  it('计数：本级=直接子，含子级=整棵子树', () => {
    expect(index.counts.get('库/实体/地点.md')).toEqual({ self: 1, subtree: 2 });
    expect(index.counts.get('库/实体/地点/印度.md')).toEqual({ self: 1, subtree: 1 });
    expect(index.counts.get('库/实体/地点/印度/尼西亚.md')).toEqual({ self: 0, subtree: 0 });
  });

  it('标签与链接计数', () => {
    expect(index.tags.get('地点/印度')).toBe(2);
    expect(index.links.get('b')).toEqual(['库/笔记/2026/10/9-a.md']);
  });

  it('pathOf 用 parent 链还原路径', () => {
    expect(pathOf(index, '库/实体/地点/印度/尼西亚.md')).toBe('地点/印度/尼西亚');
  });

  it('孤儿 parent 不丢数据也不死循环', () => {
    const broken = buildIndex([rec('库/实体/a.md', 5, '库/实体/不存在.md')]);
    expect(() => pathOf(broken, '库/实体/a.md')).not.toThrow();
    expect(broken.entities).toHaveLength(1);
  });
});
