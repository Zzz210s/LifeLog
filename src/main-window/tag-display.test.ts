import { describe, expect, it } from 'vitest';
import { tagDisplayName } from './tag-display';

describe('tagDisplayName', () => {
  it('根级标签不裁剪', () => {
    expect(tagDisplayName('工作')).toBe('工作');
    expect(tagDisplayName('todo')).toBe('todo');
  });

  it('多级路径默认只显示末级', () => {
    expect(tagDisplayName('工作/项目A/会议')).toBe('会议');
    expect(tagDisplayName('工作/项目A')).toBe('项目A');
  });

  it('maxDepth 保留末 n 级', () => {
    expect(tagDisplayName('工作/项目A/会议', 2)).toBe('项目A/会议');
    expect(tagDisplayName('工作/项目A/会议', 3)).toBe('工作/项目A/会议');
    expect(tagDisplayName('工作/项目A', 3)).toBe('工作/项目A');
  });

  it('空路径与异常 maxDepth 回退到末级', () => {
    expect(tagDisplayName('')).toBe('');
    expect(tagDisplayName('工作/项目A', 0)).toBe('项目A');
  });
});
