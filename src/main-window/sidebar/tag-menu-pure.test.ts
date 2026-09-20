/** 标签菜单纯助手测试(测试先行,G3):别名输入校验 / 合并候选 / 影响面文案 */
import { describe, expect, it } from 'vitest';
import type { TagCount } from '../../shared/types';
import { mergeCandidates, mergeImpactText, validateAliasInput } from './tag-menu-pure';

const row = (id: number, path: string, depth: number): TagCount => ({
  id,
  path,
  depth,
  sort_order: 0,
  self_count: 0,
  subtree_count: 0,
});

describe('validateAliasInput', () => {
  it('合法别名:单段名与完整路径都给 null(层级分隔 / 允许)', () => {
    expect(validateAliasInput('日漫')).toBeNull();
    expect(validateAliasInput('追番/日漫')).toBeNull();
    expect(validateAliasInput('v1.0')).toBeNull();
    expect(validateAliasInput('a-b_c')).toBeNull();
  });
  it('空与纯空白', () => {
    expect(validateAliasInput('')).toBe('别名不能为空');
    expect(validateAliasInput(' ')).toBe('别名不能包含空白字符');
  });
  it('任何空白字符(前导 / 中间 / 制表)都拒', () => {
    expect(validateAliasInput(' 日漫')).toBe('别名不能包含空白字符');
    expect(validateAliasInput('日 漫')).toBe('别名不能包含空白字符');
    expect(validateAliasInput('日漫\t')).toBe('别名不能包含空白字符');
  });
  it('含 # 拒', () => {
    expect(validateAliasInput('#日漫')).toBe('别名不能包含 #');
    expect(validateAliasInput('日#漫')).toBe('别名不能包含 #');
  });
  it('其余非法字符与非法路径形态拒', () => {
    expect(validateAliasInput('日漫!')).toBe('别名不合法(仅限文字、数字、_ - . ·,层级用 /)');
    expect(validateAliasInput('日//漫')).toBe('别名不合法(仅限文字、数字、_ - . ·,层级用 /)');
    expect(validateAliasInput('a/b/c/d/e/f')).toBe('别名不合法(仅限文字、数字、_ - . ·,层级用 /)');
  });
});

describe('mergeCandidates', () => {
  const rows = [
    row(1, '甲', 1),
    row(2, '甲/子', 2),
    row(3, '甲/子/孙', 3),
    row(4, '乙', 1),
    row(5, '乙/子', 2),
  ];
  it('剔除自身与全部子孙,保持原路径序', () => {
    expect(mergeCandidates(rows, { path: '甲' }).map((r) => r.path)).toEqual(['乙', '乙/子']);
  });
  it('只剔除自己那一支,父级与兄弟都留着', () => {
    expect(mergeCandidates(rows, { path: '甲/子' }).map((r) => r.path)).toEqual(['甲', '乙', '乙/子']);
  });
  it('路径前缀是字面量而非模糊匹配:甲X 不是 甲 的子孙', () => {
    const extra = [...rows, row(6, '甲X', 1)];
    expect(mergeCandidates(extra, { path: '甲' }).map((r) => r.path)).toEqual([
      '乙',
      '乙/子',
      '甲X',
    ]);
  });
});

describe('mergeImpactText', () => {
  it('没有关联笔记时明说,不显示「将影响 0 条」', () => {
    expect(mergeImpactText(0)).toBe('该标签暂无关联笔记');
  });
  it('有关联笔记时给条数', () => {
    expect(mergeImpactText(3)).toBe('将影响 3 条笔记');
    expect(mergeImpactText(1358)).toBe('将影响 1358 条笔记');
  });
});
