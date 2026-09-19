import { describe, expect, it } from 'vitest';
import { completeMatch, sameList, tokenAt } from './tag-complete';

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
  const all = ['工作', '工作/项目A', '工作/项目B/会议', '生活/健身'];
  it('按前缀匹配并保持路径顺序', () => { expect(completeMatch(all, '工作/')).toEqual(['工作/项目A', '工作/项目B/会议']); });
  it('空词元返回全部(限 8 条)', () => { expect(completeMatch(all, '', 2)).toHaveLength(2); });
  it('无匹配返回空', () => { expect(completeMatch(all, 'zzz')).toEqual([]); });
  it('去重:同一路径只保留一次', () => {
    expect(completeMatch(['工作', '工作', '工作/项目A'], '工作')).toEqual(['工作', '工作/项目A']);
  });
  it('默认限 8 条并按路径排序', () => {
    const many = Array.from({ length: 12 }, (_, i) => `标签${String(i).padStart(2, '0')}`);
    expect(completeMatch([...many].reverse(), '')).toEqual(many.slice(0, 8));
  });
});

describe('sameList(输入事件里的 bail out 判据)', () => {
  it('长度或元素不同 -> false,顺序不同也算不同', () => {
    expect(sameList([], [])).toBe(true);
    expect(sameList(['a'], ['a'])).toBe(true);
    expect(sameList([], ['a'])).toBe(false);
    expect(sameList(['a'], [])).toBe(false);
    expect(sameList(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameList(['a'], ['ab'])).toBe(false);
  });
});
