import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { noteTag as tag } from './__fixtures__/note-tag';
import { composeSource, normalizeForSave, prepareForSave } from './note-source';

describe('composeSource', () => {
  it('正文与标签各占一行', () => {
    expect(composeSource('正文', [tag('a'), tag('b')])).toBe('正文\n#a #b');
  });

  it('正文以围栏代码块结尾时标签另起一行', () => {
    expect(composeSource('```\ncode\n```', [tag('x')])).toBe('```\ncode\n```\n#x');
  });

  it('空正文只剩标签行(含纯空白正文)', () => {
    expect(composeSource('', [tag('a')])).toBe('#a');
    expect(composeSource('   \n', [tag('a')])).toBe('#a');
  });

  it('无标签时只裁行尾空白，保留首行缩进', () => {
    expect(composeSource(' 正文 \n', [])).toBe(' 正文');
    expect(composeSource('', [])).toBe('');
  });

  it('只裁行尾空白：整条缩进代码块与首行缩进往返不损失', () => {
    expect(composeSource('    const a = 1;\n    const b = 2;', [tag('x')])).toBe(
      '    const a = 1;\n    const b = 2;\n#x'
    );
    expect(composeSource('  - 任务\n  - 任务二', [tag('x')])).toBe('  - 任务\n  - 任务二\n#x');
  });

  it('去掉末尾多余空行', () => {
    expect(composeSource('正文\n\n\n', [tag('x')])).toBe('正文\n#x');
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
    const text = normalizeForSave(composeSource(body, [tag('x')]));
    expect(text.startsWith('    const a = 1;')).toBe(true);
    // 去掉标签行后应与原文完全一致(后端在标签行另起一行,不侵入正文)
    expect(text.split('\n').slice(0, 2).join('\n')).toBe(body);
  });

  it('纯空白归一为空内容(保存路径与按钮据此拒绝)', () => {
    expect(normalizeForSave('   \n\t').trim()).toBe('');
  });
});

describe('prepareForSave', () => {
  it('纯空白返回 null,拒绝保存', () => {
    expect(prepareForSave('')).toBeNull();
    expect(prepareForSave('   \n\t ')).toBeNull();
  });

  it('只裁行尾空白:整条缩进代码块的首行缩进在创建路径保留', () => {
    expect(prepareForSave('    const a = 1;\n    const b = 2;\n')).toBe(
      '    const a = 1;\n    const b = 2;'
    );
    expect(prepareForSave('  - 一\n  - 二')).toBe('  - 一\n  - 二');
  });

  it('标签行尾随空白裁掉(创建路径仍由后端剥离标签)', () => {
    expect(prepareForSave('正文 #a  \n\n')).toBe('正文 #a');
  });
});

/**
 * 关系名进源码(设计 §5.3):有名字的线合成 `#路径(名字)`,无名字的线仍是 `#路径`。
 * 与解析层的契约由共享向量 `fixtures/tag-grammar.json` 钉住(两侧读同一份 `lines` 字段)。
 */
interface FixtureLine {
  path: string;
  name: string | null;
}
interface FixtureCase {
  why: string;
  source: string;
  content: string;
  tags: string[];
  lines?: FixtureLine[];
}

const tagCases = JSON.parse(
  readFileSync(new URL('../../fixtures/tag-grammar.json', import.meta.url), 'utf8')
) as FixtureCase[];

describe('composeSource 关系名', () => {
  it('无名字的线写 #路径', () => {
    expect(composeSource('正文', [tag('目标')])).toBe('正文\n#目标');
    expect(composeSource('正文', [tag('目标', null)])).toBe('正文\n#目标');
  });

  it('有名字的线写 #路径(名字)', () => {
    expect(composeSource('正文', [tag('地点/中国大陆', '国籍')])).toBe(
      '正文\n#地点/中国大陆(国籍)'
    );
  });

  it('空标签集合只输出正文', () => {
    expect(composeSource('正文', [])).toBe('正文');
    expect(composeSource('  正文 \n', [])).toBe('  正文');
  });

  it('多条线各自带自己的名字(名字不丢、顺序照数据给)', () => {
    expect(composeSource('', [tag('工作', '重点'), tag('生活')])).toBe('#工作(重点) #生活');
  });

  it('共享向量的 lines 能合成回带名字的标签行,且与向量源码逐字节一致', () => {
    let exact = 0;
    for (const c of tagCases) {
      if (!c.lines) continue;
      const tags = c.lines.map((l) => tag(l.path, l.name));
      const src = composeSource(c.content, tags);
      for (const l of c.lines) {
        expect(src, c.why).toContain('#' + l.path);
        if (l.name) expect(src, c.why).toContain('(' + l.name + ')');
      }
      // 向量源码本身就是「正文 + 换行 + 标签行」时,compose 必须逐字节复现它
      if (src === c.source) exact += 1;
    }
    expect(exact, '至少若干条向量可以直接往返').toBeGreaterThanOrEqual(5);
  });
});
