/** 标签菜单纯助手测试(测试先行,G3):别名输入校验 / 移动候选 / 关系候选 */
import { describe, expect, it } from 'vitest';
import type { TagCount } from '../../shared/types';
import { mergeCandidates, relationCandidates, validateAliasInput } from './tag-menu-pure';

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
    // 层级深度不设上限(2026-09-28):6 层路径也是合法别名
    expect(validateAliasInput('a/b/c/d/e/f')).toBeNull();
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
    const why = '别名不合法(可用行内 md 语法;层级用 /,不能含空白或 #)';
    expect(validateAliasInput('日//漫')).toBe(why);
    expect(validateAliasInput('a//b')).toBe(why);
  });
  it('T3 放宽:段内行内 md 与标点不再被拦(与仓库层 check_alias 对齐)', () => {
    expect(validateAliasInput('日漫!')).toBeNull();
    expect(validateAliasInput('[郴](chēn)州市')).toBeNull();
    expect(validateAliasInput('地点/[郴](chēn)州市')).toBeNull();
  });
});

describe('mergeCandidates(移动面板用)', () => {
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

describe('relationCandidates', () => {
  const rows = [row(1, '甲', 1), row(2, '乙', 1), row(3, '丙', 1), row(4, '丁', 1)];

  it('排除自己', () => {
    expect(relationCandidates(rows, '甲', []).map((r) => r.path)).toEqual(['乙', '丙', '丁']);
  });

  it('排除已建立关系的目标(自己与已建立同时命中时也不重复)', () => {
    expect(relationCandidates(rows, '甲', [{ path: '丙' }]).map((r) => r.path)).toEqual(['乙', '丁']);
    expect(relationCandidates(rows, '乙', [{ path: '乙' }]).map((r) => r.path)).toEqual([
      '甲',
      '丙',
      '丁',
    ]);
  });

  it('022 起不再按「已登记类型」过滤:任何标签都能当目标', () => {
    expect(relationCandidates(rows, '甲', []).map((r) => r.id)).toEqual([2, 3, 4]);
  });

  it('保持原路径序,不改动传入数组', () => {
    const out = relationCandidates(rows, '甲', [{ path: '乙' }]);
    expect(out.map((r) => r.id)).toEqual([3, 4]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });
});
