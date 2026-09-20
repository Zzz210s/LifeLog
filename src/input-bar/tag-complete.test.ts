import { describe, expect, it } from 'vitest';
import type { CompleteItem } from '../shared/types';
import { completeMatch, sameList, tokenAt } from './tag-complete';

const tag = (path: string): CompleteItem => ({ path, kind: 'tag' });
const alias = (path: string): CompleteItem => ({ path, kind: 'alias' });

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

describe('sameList(输入事件里的 bail out 判据)', () => {
  it('长度、路径或来源不同 -> false,顺序不同也算不同', () => {
    expect(sameList([], [])).toBe(true);
    expect(sameList([tag('a')], [tag('a')])).toBe(true);
    expect(sameList([], [tag('a')])).toBe(false);
    expect(sameList([tag('a')], [])).toBe(false);
    expect(sameList([tag('a'), tag('b')], [tag('b'), tag('a')])).toBe(false);
    expect(sameList([tag('a')], [tag('ab')])).toBe(false);
    expect(sameList([tag('a')], [alias('a')])).toBe(false);
  });
});
