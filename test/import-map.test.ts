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
    expect(at('拾枝/实体/地点.md')?.content).toBeTruthy();
  });

  it('笔记按年月分目录，标签进正文，关系进顶层属性（A 方案）', () => {
    const f = at('拾枝/笔记/2026/10/去了印度.md');
    expect(f?.content).toContain('lifelog_created: 2026-10-26T09:30:00');
    expect(f?.content).not.toContain('lifelog_id');
    expect(f?.content).toContain('国籍: "[[地点/印度]]"');
    expect(f?.content).toContain('tags: [地点/印度]');
  });

  it('同一关系的多个目标折成数组', () => {
    const many = buildFiles(
      [...points, P(4, '日本', null)],
      [...lines, { from_id: 9, to_id: 4, name_id: 3 }],
    );
    const f = many.files.find((x) => x.path.includes('去了印度'));
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
    expect(r.files[0].path).toBe('拾枝/笔记/2026/03/大地 ）.md');
  });
});

describe('frontmatter 边界（真机测试抓到的缺陷）', () => {
  const { files } = buildFiles(points, lines);
  const fmOf = (path: string) => {
    const content = files.find((f) => f.path === path)!.content;
    const parts = content.split('---');
    return parts.length >= 3 ? parts[1] : '';
  };

  it('关系属性必须落在闭合的 --- 之前', () => {
    expect(fmOf('拾枝/笔记/2026/10/去了印度.md')).toContain('国籍: "[[地点/印度]]"');
    expect(fmOf('拾枝/实体/地点/印度.md')).toContain('lifelog_parent: 地点');
  });

  it('文件以 --- 开头，闭合后才是正文', () => {
    const content = files.find((f) => f.path.includes('去了印度'))!.content;
    expect(content.startsWith('---\n')).toBe(true);
    const close = content.indexOf('\n---\n');
    expect(close).toBeGreaterThan(0);
    expect(content).toContain('tags: [地点/印度]');
  });
});

describe('文件名不带 id（用户定调）+ 同标题去重', () => {
  it('笔记与实体都不写 lifelog_id，文件名只有标题', () => {
    const { files } = buildFiles(points, lines);
    expect(files.every((f) => !f.content.includes('lifelog_id'))).toBe(true);
    expect(files.map((f) => f.path)).toContain('拾枝/笔记/2026/10/去了印度.md');
  });

  it('同目录同标题按 (2)、(3) 递增，不覆盖', () => {
    const dup = buildFiles(
      [
        { id: 1, meta: '同一个标题', created_at: '2026-10-26T00:00:00', path: null, parent_id: null },
        { id: 2, meta: '同一个标题', created_at: '2026-10-26T00:00:00', path: null, parent_id: null },
        { id: 3, meta: '同一个标题', created_at: '2026-10-26T00:00:00', path: null, parent_id: null },
      ],
      [],
    );
    expect(dup.files.map((f) => f.path)).toEqual([
      '拾枝/笔记/2026/10/同一个标题 (2).md',
      '拾枝/笔记/2026/10/同一个标题 (3).md',
      '拾枝/笔记/2026/10/同一个标题.md',
    ]);
  });
});

describe('实体文件不要空 frontmatter（用户反馈数据不对）', () => {
  it('顶层无属性的实体不生成 --- 块，正文给标题', () => {
    const { files } = buildFiles([P(1, '日记', '日记')], []);
    expect(files[0].content).toBe('# 日记\n');
  });

  it('有 parent 的实体保留 frontmatter 与标题', () => {
    const { files } = buildFiles([P(1, '地点', '地点'), P(2, '印度', '地点/印度', 1)], []);
    const child = files.find((f) => f.path.includes('印度'))!;
    expect(child.content).toContain('lifelog_parent: 地点');
    expect(child.content).toContain('# 印度');
  });
});
