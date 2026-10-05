import { describe, expect, it } from 'vitest';
import { exprTagSpans } from './expr-tag-spans';

const spans = (text: string) => exprTagSpans(text).map((s) => [s.path, s.start, s.end]);

describe('exprTagSpans:表达式里的标签叶子定位(展示级)', () => {
  it('按出现顺序给出 #路径 的路径与区间', () => {
    expect(spans('#工作 AND NOT #临时')).toEqual([
      ['工作', 0, 3],
      ['临时', 12, 15],
    ]);
  });

  it('#= 仅本级与多级路径都能认出', () => {
    expect(spans('#=工作')).toEqual([['工作', 0, 4]]);
    expect(spans('#地点/国籍/日本')).toEqual([['地点/国籍/日本', 0, 9]]);
  });

  it('内嵌标点属于名称:v1.0 整串是路径(判别力)', () => {
    expect(spans('#v1.0 AND todo')).toEqual([['v1.0', 0, 5]]);
  });

  it('引号短语里的 # 不是标签', () => {
    expect(spans('"买牛奶" OR #生活')).toEqual([['生活', 9, 12]]);
    expect(spans('"#工作"')).toEqual([]);
  });

  it('裸词内部的 # 不是标签(后端词法同一口径)', () => {
    expect(spans('abc#工作 AND #生活')).toEqual([['生活', 11, 14]]);
  });

  it('结构非法的 # 整串不认(原样留给文本)', () => {
    expect(spans('#工作.')).toEqual([]);
    expect(spans('#/工作')).toEqual([]);
    expect(spans('#工作/')).toEqual([]);
    expect(spans('#a//b')).toEqual([]);
  });

  it('& | 运算符与括号不干扰,落单符号不吞字', () => {
    expect(spans('(#工作 && #临时) || #生活')).toEqual([
      ['工作', 1, 4],
      ['临时', 8, 11],
      ['生活', 16, 19],
    ]);
    expect(spans('a&b')).toEqual([]);
  });
});
