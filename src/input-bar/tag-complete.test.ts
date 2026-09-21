import { describe, expect, it } from 'vitest';
import { SUGGEST_MAX_ROWS, SUGGEST_PAD_CSS, SUGGEST_ROW_CSS, suggestListHeightCss } from '../shared/input-geometry';
import type { CompleteItem } from '../shared/types';
import { COMPLETE_LIMIT, completeMatch, sameList, tokenAt } from './tag-complete';

/**
 * R5-1 不变量:候选上限(COMPLETE_LIMIT)与列表最大行数(SUGGEST_MAX_ROWS)必须相等 ——
 * TagCompleteList 已不再声明 overflow(靠“内容高度 == 让出的高度”来避免出现滚不动的滚动条):
 * 若候选上限变大而列表上限不变,多出的候选会被窗口裁掉;反之列表上限变大则又冒出一条空滚动条。
 */
describe('R5-1 列表尺寸不变量:候选上限 = 最大行数,内容永不溢出', () => {
  it('两值相等,且 8 条候选的列表高度正好等于上限高度', () => {
    expect(COMPLETE_LIMIT).toBe(SUGGEST_MAX_ROWS);
    expect(suggestListHeightCss(COMPLETE_LIMIT)).toBe(SUGGEST_MAX_ROWS * SUGGEST_ROW_CSS + SUGGEST_PAD_CSS);
  });
});

const tag = (path: string): CompleteItem => ({ path, kind: 'tag' });
const alias = (path: string): CompleteItem => ({ path, kind: 'alias' });
const similar = (path: string): CompleteItem => ({ path, kind: 'similar' });

describe('tokenAt(前导字符规则与 Rust tags.rs 逐字对齐)', () => {
  it('字母数字后不匹配:abc# / C#', () => {
    expect(tokenAt('abc#')).toBeNull();
    expect(tokenAt('C#')).toBeNull();
  });
  it('# 与 & 后不匹配:#a# / a&#b', () => {
    expect(tokenAt('#a#')).toBeNull();
    expect(tokenAt('a&#b')).toBeNull();
  });
  it('行首 # 匹配,词元为空串', () => { expect(tokenAt('#')).toBe(''); });
  it('CJK 后放行:买牛奶# 匹配空词元、买牛奶#杂 取出杂', () => {
    expect(tokenAt('买牛奶#')).toBe('');
    expect(tokenAt('买牛奶#杂')).toBe('杂');
  });
  it('词元不含空白与 #:#ab 后接空格不匹配、#a#b 取不出 b', () => {
    expect(tokenAt('#ab ')).toBeNull();
    expect(tokenAt('#a#b')).toBeNull();
  });
  it('空格/标点后的 # 放行:看 #ab 取出 ab', () => {
    expect(tokenAt('看 #ab')).toBe('ab');
  });
});

describe('completeMatch', () => {
  const all = [tag('工作'), tag('工作/项目A'), tag('工作/项目B/会议'), tag('生活/健身')];
  it('标签项按前缀匹配并保持路径顺序', () => {
    expect(completeMatch(all, '工作/')).toEqual([tag('工作/项目A'), tag('工作/项目B/会议')]);
  });
  it('空词元返回全部标签项(限 8 条)', () => {
    expect(completeMatch(all, '', 2)).toEqual([tag('工作'), tag('工作/项目A')]);
  });
  it('无匹配返回空', () => { expect(completeMatch(all, 'zzz')).toEqual([]); });
  it('去重:同一路径只保留一次(标签优先)', () => {
    expect(completeMatch([tag('工作'), tag('工作'), tag('工作/项目A')], '工作')).toEqual([
      tag('工作'),
      tag('工作/项目A'),
    ]);
    // 别名与标签同路径:标签项胜出,别名项不出现
    expect(completeMatch([tag('工作/项目A'), alias('工作/项目A')], '工作')).toEqual([
      tag('工作/项目A'),
    ]);
  });
  it('别名项保留:后端已按**别名字符串**前缀筛过,不再按目标路径过滤', () => {
    // 词元 "日漫" 与目标路径 "追番/日漫" 不同形,别名项仍须展示
    expect(completeMatch([alias('追番/日漫')], '日漫')).toEqual([alias('追番/日漫')]);
    expect(completeMatch([alias('追番/日漫'), tag('日期')], '日')).toEqual([
      tag('日期'),
      alias('追番/日漫'),
    ]);
  });
  it('默认限 8 条并按路径排序', () => {
    const many = Array.from({ length: 12 }, (_, i) => tag(`标签${String(i).padStart(2, '0')}`));
    expect(completeMatch([...many].reverse(), '')).toEqual(many.slice(0, 8));
  });
  it('顺序稳定:标签项整体在前、别名项在后,各项内部按路径序,与输入顺序无关', () => {
    const a = completeMatch([alias('乙'), tag('乙'), alias('甲')], '');
    const b = completeMatch([alias('甲'), tag('乙'), alias('乙')], '');
    expect(a).toEqual([tag('乙'), alias('甲')]);
    expect(b).toEqual(a);
  });
});

describe('completeMatch 近义项(G4 spec §2 D8)', () => {
  it('近义项不做前缀过滤:其 path 按定义不以词元开头(否则早作为标签项返回)', () => {
    expect(completeMatch([similar('追番/日漫')], '日漫')).toEqual([similar('追番/日漫')]);
  });
  it('顺序固定 tag -> alias -> similar,各段内部按路径序,与输入顺序无关', () => {
    const a = completeMatch([similar('乙近似'), alias('甲别名'), tag('丙标签')], '');
    const b = completeMatch([tag('丙标签'), similar('乙近似'), alias('甲别名')], '');
    expect(a).toEqual([tag('丙标签'), alias('甲别名'), similar('乙近似')]);
    expect(b).toEqual(a);
  });
  it('去重按 path:标签优先,其次别名,近义项最后被丢掉', () => {
    expect(
      completeMatch([similar('工作/项目A'), alias('工作/项目A'), tag('工作/项目A')], '工作')
    ).toEqual([tag('工作/项目A')]);
    expect(completeMatch([similar('追番/日漫'), alias('追番/日漫')], '日漫')).toEqual([
      alias('追番/日漫'),
    ]);
  });
  it('近义项同样计入展示上限', () => {
    const many = Array.from({ length: 3 }, (_, i) => similar(`近似${i}`));
    expect(completeMatch(many, 'x', 2)).toEqual([similar('近似0'), similar('近似1')]);
  });
});

describe('sameList(输入事件里的 bail out 判据)', () => {
  it('长度、路径或来源不同 -> false,顺序不同也算不同', () => {
    expect(sameList([], [])).toBe(true);
    expect(sameList([tag('a')], [tag('a')])).toBe(true);
    expect(sameList([], [tag('a')])).toBe(false);
    expect(sameList([tag('a')], [])).toBe(false);
    expect(sameList([tag('a'), tag('b')], [tag('b'), tag('a')])).toBe(false);
    expect(sameList([tag('a')], [tag('ab')])).toBe(false);
    expect(sameList([tag('a')], [alias('a')])).toBe(false);
    expect(sameList([tag('a')], [similar('a')])).toBe(false);
    expect(sameList([alias('a')], [similar('a')])).toBe(false);
  });
});
