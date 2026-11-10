import { describe, expect, it } from 'vitest';
import { KEY, notePath, normalizeTarget, readRecord } from '../src/store/schema';

describe('readRecord', () => {
  it('读全字段', () => {
    const r = readRecord('库/笔记/2026/10/7-a.md', {
      [KEY.id]: 7,
      [KEY.created]: '2026-10-26T09:00:00',
      [KEY.parent]: '时间/2026/10/26',
      [KEY.relations]: [{ name: '国籍', to: '地点/日本' }],
    }, '正文');
    expect(r).toMatchObject({ id: 7, parent: '时间/2026/10/26', body: '正文' });
    expect(r.relations).toEqual([{ name: '国籍', to: '地点/日本' }]);
  });

  it('缺 frontmatter 时给安全默认值，不抛', () => {
    const r = readRecord('库/笔记/a.md', undefined, '');
    expect(r.id).toBe(-1);
    expect(r.parent).toBeNull();
    expect(r.relations).toEqual([]);
  });

  it('关系形状不合法时丢弃该条，不整条丢弃', () => {
    const r = readRecord('库/实体/x.md', { [KEY.relations]: [{ name: '国籍' }, { name: '状态', to: '未完成' }] }, '');
    expect(r.relations).toEqual([{ name: '状态', to: '未完成' }]);
  });
});

describe('notePath', () => {
  it('按 createdAt 的年月分目录', () => {
    expect(notePath(12, '标题', '2026-03-05T01:02:03', '拾枝')).toBe('拾枝/笔记/2026/03/12-标题.md');
  });

  it('剥掉文件名非法字符与超长标题', () => {
    const p = notePath(3, 'a/b:c*d?e|f#g^h[i]', '2026-01-01T00:00:00', '拾枝');
    expect(p).toBe('拾枝/笔记/2026/01/3-abcdefghi.md');
  });

  it('空标题回落到未命名', () => {
    expect(notePath(4, '   ', '2026-01-01T00:00:00', '拾枝')).toBe('拾枝/笔记/2026/01/4-未命名.md');
  });
});

describe('normalizeTarget', () => {
  it('wiki 链接剥成纯目标，别名也剥', () => {
    expect(normalizeTarget('[[地点/日本]]')).toBe('地点/日本');
    expect(normalizeTarget('[[地点/日本|日本]]')).toBe('地点/日本');
    expect(normalizeTarget(' 地点/日本 ')).toBe('地点/日本');
  });

  it('readRecord 把关系目标统一成纯路径', () => {
    const r = readRecord('库/实体/x.md', { [KEY.relations]: [{ name: '国籍', to: '[[地点/日本]]' }] }, '');
    expect(r.relations[0].to).toBe('地点/日本');
  });
});
