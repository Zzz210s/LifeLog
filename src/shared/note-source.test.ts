import { describe, expect, it } from 'vitest';
import { composeSource, normalizeForSave } from './note-source';

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

describe('normalizeForSave', () => {
  it('只裁行尾空白,不裁首行缩进', () => {
    expect(normalizeForSave('    const a = 1;\n    const b = 2;\n#x')).toBe(
      '    const a = 1;\n    const b = 2;\n#x'
    );
    expect(normalizeForSave('正文  \n\n')).toBe('正文');
  });

  it('整条缩进代码块编辑往返不损失缩进(保存裁剪不得整体 trim)', () => {
    const body = '    const a = 1;\n    const b = 2;';
    const text = normalizeForSave(composeSource(body, ['x']));
    expect(text.startsWith('    const a = 1;')).toBe(true);
    // 去掉标签行后应与原文完全一致(后端在标签行另起一行,不侵入正文)
    expect(text.split('\n').slice(0, 2).join('\n')).toBe(body);
  });

  it('纯空白归一为空内容(保存路径与按钮据此拒绝)', () => {
    expect(normalizeForSave('   \n\t').trim()).toBe('');
  });
});
