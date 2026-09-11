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

  it('无标签时只裁行尾空白，保留首行缩进', () => {
    expect(composeSource(' 正文 \n', [])).toBe(' 正文');
    expect(composeSource('', [])).toBe('');
  });

  it('只裁行尾空白：整条缩进代码块与首行缩进往返不损失', () => {
    expect(composeSource('    const a = 1;\n    const b = 2;', ['x'])).toBe(
      '    const a = 1;\n    const b = 2;\n#x'
    );
    expect(composeSource('  - 任务\n  - 任务二', ['x'])).toBe('  - 任务\n  - 任务二\n#x');
  });

  it('去掉末尾多余空行', () => {
    expect(composeSource('正文\n\n\n', ['x'])).toBe('正文\n#x');
  });
});
