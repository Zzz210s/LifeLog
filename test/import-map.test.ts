import { describe, expect, it } from 'vitest';
import { PointRow, buildFiles } from '../src/import/map';

const P = (id: number, meta: string, path: string | null, parent_id: number | null = null): PointRow => ({
  id,
  meta,
  created_at: '2026-10-26T09:30:00',
  path,
  parent_id,
});

const points: PointRow[] = [
  P(1, '地点', '地点'),
  P(2, '印度', '地点/印度', 1),
  P(3, '国籍', null), // 名字点
  P(9, '去了印度', null),
];

const lines = [
  { from_id: 1, to_id: 2, name_id: 0 },
  { from_id: 9, to_id: 2, name_id: null },
  { from_id: 9, to_id: 2, name_id: 3 },
];

describe('buildFiles', () => {
  const { files, stats } = buildFiles(points, lines);
  const at = (p: string) => files.find((f) => f.path === p);

  it('计数与原生口径一致', () => {
    expect(stats).toEqual({ notes: 1, entities: 2, tags: 1, relations: 1, tree: 1 });
  });

  it('名字点不生成文件（不进树也不进图）', () => {
    expect(files.some((f) => f.path.includes('国籍'))).toBe(false);
    expect(files).toHaveLength(3);
  });

  it('实体文件带 parent 路径，路径=目录', () => {
    const f = at('拾枝/实体/地点/印度.md');
    expect(f?.content).toContain('lifelog_parent: 地点');
    expect(at('拾枝/实体/地点.md')?.content).toContain('lifelog_id: 1');
  });

  it('笔记按年月分目录，标签进正文，关系进顶层属性（A 方案）', () => {
    const f = at('拾枝/笔记/2026/10/9-去了印度.md');
    expect(f?.content).toContain('lifelog_created: 2026-10-26T09:30:00');
    expect(f?.content).toContain('国籍: "[[地点/印度]]"');
    expect(f?.content).toContain('#地点/印度');
  });

  it('同一关系的多个目标折成数组', () => {
    const many = buildFiles(
      [...points, P(4, '日本', null)],
      [...lines, { from_id: 9, to_id: 4, name_id: 3 }],
    );
    const f = many.files.find((x) => x.path.includes('9-去了印度'));
    expect(f?.content).toContain('国籍: ["[[地点/印度]]", "[[日本]]"]');
  });

  it('父级缺失时不写 parent 也不抛', () => {
    const r = buildFiles([P(5, '孤儿', '地点/孤儿', 99)], []);
    expect(r.files[0].content).not.toContain('lifelog_parent');
  });
});

describe('文件名清洗（真库演练抓到的缺陷）', () => {
  it('标题里的换行不会进文件名', () => {
    const r = buildFiles([{ id: 869, meta: '大地\n）', created_at: '2026-03-28 00:00:00', path: null, parent_id: null }], []);
    expect(r.files[0].path).not.toMatch(/[\n\r]/);
    expect(r.files[0].path).toBe('拾枝/笔记/2026/03/869-大地 ）.md');
  });
});
