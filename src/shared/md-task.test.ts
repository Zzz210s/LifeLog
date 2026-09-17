import { describe, expect, it } from 'vitest';
import { toggleTaskAt } from './md-task';
import { composeSource } from './note-source';

describe('toggleTaskAt 基本切换', () => {
  it('未勾选 -> 勾选,行其余内容一字不动', () => {
    expect(toggleTaskAt('- [ ] 买牛奶', 0)).toBe('- [x] 买牛奶');
  });

  it('已勾选 -> 取消勾选', () => {
    expect(toggleTaskAt('- [x] 买牛奶', 0)).toBe('- [ ] 买牛奶');
  });

  it('大写 [X] 视为勾选,切换后归一为空格(语义不变)', () => {
    expect(toggleTaskAt('- [X] 买牛奶', 0)).toBe('- [ ] 买牛奶');
  });

  it('只改标记那一个字符:前缀/缩进/尾随空白/多行全保留', () => {
    const src = '标题\n   * [ ]   缩进与多空格   \n结尾';
    const out = toggleTaskAt(src, 0);
    expect(out).toBe('标题\n   * [x]   缩进与多空格   \n结尾');
    expect(out!.replace('x', ' ')).toBe(src);
  });

  it('CRLF 换行不被归一(逐字节保留)', () => {
    expect(toggleTaskAt('- [ ] a\r\n- [ ] b', 1)).toBe('- [ ] a\r\n- [x] b');
  });

  it('编号 0 起、按文档顺序:第 1 项只动第二行', () => {
    expect(toggleTaskAt('- [ ] a\n- [ ] b\n- [ ] c', 1)).toBe('- [ ] a\n- [x] b\n- [ ] c');
  });
});

describe('toggleTaskAt 各种列表形态', () => {
  it('- / * / + 与有序 1. / 2) 都认', () => {
    const src = '* [ ] a\n+ [ ] b\n- [ ] c\n1. [ ] d\n2) [ ] e';
    expect(toggleTaskAt(src, 0)).toContain('* [x] a');
    expect(toggleTaskAt(src, 1)).toContain('+ [x] b');
    expect(toggleTaskAt(src, 2)).toContain('- [x] c');
    expect(toggleTaskAt(src, 3)).toContain('1. [x] d');
    expect(toggleTaskAt(src, 4)).toContain('2) [x] e');
  });

  it('多位编号、嵌套缩进、引用块里的任务项都按文档顺序计数', () => {
    const src = '10. [ ] a\n\n   - [ ] 嵌套\n\n> - [x] 引用里';
    expect(toggleTaskAt(src, 0)).toContain('10. [x] a');
    expect(toggleTaskAt(src, 1)).toContain('- [x] 嵌套');
    expect(toggleTaskAt(src, 2)).toContain('> - [ ] 引用里');
  });

  it('非任务项不占位:普通列表项被跳过', () => {
    const src = '- 普通\n- [ ] 任务';
    expect(toggleTaskAt(src, 0)).toBe('- 普通\n- [x] 任务');
    expect(toggleTaskAt(src, 1)).toBeNull();
  });
});

describe('toggleTaskAt 边界与排除', () => {
  it('越界、负数、非整数一律 null', () => {
    const src = '- [ ] a';
    expect(toggleTaskAt(src, 1)).toBeNull();
    expect(toggleTaskAt(src, -1)).toBeNull();
    expect(toggleTaskAt(src, 1.5)).toBeNull();
    expect(toggleTaskAt(src, Number.NaN)).toBeNull();
  });

  it('没有任何任务项时任何索引都 null', () => {
    expect(toggleTaskAt('普通正文\n- 普通列表', 0)).toBeNull();
    expect(toggleTaskAt('', 0)).toBeNull();
  });

  it('围栏代码块(``` 与 ~~~,含更长围栏)里的 - [ ] 不算任务项', () => {
    expect(toggleTaskAt('```\n- [ ] 示例\n```\n- [ ] 真任务', 0)).toBe(
      '```\n- [ ] 示例\n```\n- [x] 真任务'
    );
    expect(toggleTaskAt('~~~\n- [ ] 示例\n~~~\n- [ ] 真任务', 0)).toContain('- [x] 真任务');
    expect(toggleTaskAt('````\n- [ ] 示例\n````\n- [ ] 真任务', 0)).toContain('- [x] 真任务');
  });

  it('缩进代码块里的 - [ ] 不算任务项', () => {
    expect(toggleTaskAt('    - [ ] 示例\n\n- [ ] 真任务', 0)).toBe(
      '    - [ ] 示例\n\n- [x] 真任务'
    );
  });

  it('行内代码里的 - [ ] 不算任务项', () => {
    expect(toggleTaskAt('用 `- [ ] x` 表示待办\n\n- [ ] 真任务', 0)).toBe(
      '用 `- [ ] x` 表示待办\n\n- [x] 真任务'
    );
  });

  it('标记后无空格/无内容不算任务项(与 markdown-it-task-lists 判定一致)', () => {
    expect(toggleTaskAt('- [ ]a\n- [x]b', 0)).toBeNull();
    expect(toggleTaskAt('- [ ]\n- [x]', 0)).toBeNull();
  });

  it('转义写法 \\[ \\] 不算任务项', () => {
    expect(toggleTaskAt('- \\[ \\] 不是\n- [ ] 是', 0)).toBe('- \\[ \\] 不是\n- [x] 是');
  });

  it('任务项首行标记 + 续行:只改标记,续行不丢', () => {
    expect(toggleTaskAt('- [ ] 首行\n  续行 - [ ] 伪', 0)).toBe(
      '- [x] 首行\n  续行 - [ ] 伪'
    );
  });
});

describe('勾选写回的标签契约', () => {
  it('composeSource(新正文, 全部标签) 不丢任何标签', () => {
    const note = { content: '- [ ] 买牛奶', tags: ['待办', '时间排序/2026/09/17'] };
    const next = toggleTaskAt(note.content, 0);
    const source = composeSource(next!, note.tags);
    expect(source).toBe('- [x] 买牛奶\n#待办 #时间排序/2026/09/17');
    for (const t of note.tags) expect(source).toContain('#' + t);
  });
});
