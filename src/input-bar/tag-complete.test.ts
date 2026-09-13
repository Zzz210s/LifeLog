import { describe, expect, it } from 'vitest';
import { completeMatch } from './tag-complete';

describe('completeMatch', () => {
  const all = ['工作', '工作/项目A', '工作/项目B/会议', '生活/健身'];
  it('按前缀匹配并保持路径顺序', () => { expect(completeMatch(all, '工作/')).toEqual(['工作/项目A', '工作/项目B/会议']); });
  it('空词元返回全部(限 8 条)', () => { expect(completeMatch(all, '', 2)).toHaveLength(2); });
  it('无匹配返回空', () => { expect(completeMatch(all, 'zzz')).toEqual([]); });
  it('去重:同一路径只保留一次', () => {
    expect(completeMatch(['工作', '工作', '工作/项目A'], '工作')).toEqual(['工作', '工作/项目A']);
  });
  it('默认限 8 条并按路径排序', () => {
    const many = Array.from({ length: 12 }, (_, i) => `标签${String(i).padStart(2, '0')}`);
    expect(completeMatch([...many].reverse(), '')).toEqual(many.slice(0, 8));
  });
});
