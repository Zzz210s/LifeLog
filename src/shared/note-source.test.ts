import { describe, expect, it } from 'vitest';
import { composeSource } from './note-source';

describe('composeSource', () => {
  it('正文与标签各占一行', () => {
    expect(composeSource('正文', ['a', 'b'])).toBe('正文\n#a #b');
  });

  it('正文以围栏代码块结尾时标签另起一行', () => {
    expect(composeSource('```\ncode\n```', ['x'])).toBe('```\ncode\n```\n#x');
  });

  it('空正文只剩标签行(含纯空白正文)', () => {
    expect(composeSource('', ['a'])).toBe('#a');
    expect(composeSource('   \n', ['a'])).toBe('#a');
  });

  it('无标签时返回修剪后的正文', () => {
    expect(composeSource(' 正文 \n', [])).toBe('正文');
    expect(composeSource('', [])).toBe('');
  });
});
