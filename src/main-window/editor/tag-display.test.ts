import { describe, expect, it } from 'vitest';
import { tagDisplayName } from './tag-display';

describe('tagDisplayName(S4:一律完整路径)', () => {
  it('根级标签原样', () => {
    expect(tagDisplayName('工作')).toBe('工作');
    expect(tagDisplayName('todo')).toBe('todo');
  });

  it('多级路径原样返回,不退化成末级', () => {
    expect(tagDisplayName('工作/项目A/会议')).toBe('工作/项目A/会议');
    expect(tagDisplayName('工作/项目A')).toBe('工作/项目A');
    expect(tagDisplayName('时间排序/2026/09/17')).toBe('时间排序/2026/09/17');
  });

  it('不同父级下的同名末级可区分', () => {
    expect(tagDisplayName('工作/会议')).not.toBe(tagDisplayName('生活/会议'));
  });

  it('空路径原样', () => {
    expect(tagDisplayName('')).toBe('');
  });
});
