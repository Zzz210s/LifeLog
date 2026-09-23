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
    expect(COMPLETE_LIMIT).toBe(8);
    expect(COMPLETE_LIMIT).toBe(SUGGEST_MAX_ROWS);
    expect(suggestListHeightCss(COMPLETE_LIMIT)).toBe(SUGGEST_MAX_ROWS * SUGGEST_ROW_CSS + SUGGEST_PAD_CSS);
  });
});

const tag = (path: string): CompleteItem => ({ path, kind: 'tag' });
const alias = (path: string): CompleteItem => ({ path, kind: 'alias' });
const similar = (path: string): CompleteItem => ({ path, kind: 'similar' });
const paths = (rows: ReturnType<typeof completeMatch>): string[] => rows.map((r) => r.path);

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

describe('completeMatch 有词元:换 fuzzy-score 排序(设计 §3.5)', () => {
  const all = [tag('工作'), tag('工作/项目A'), tag('工作/项目B/会议'), tag('生活/健身')];

  it('非前缀命中也能找到:词元 项A -> 工作/项目A(旧子串引擎找不到)', () => {
    expect(paths(completeMatch(all, '项A'))).toEqual(['工作/项目A']);
  });

  it('前缀命中整档高于包含命中(同一引擎的分层档位)', () => {
    const rows = completeMatch([tag('生活/项目'), tag('项目'), tag('工作/项目A')], '项目');
    expect(paths(rows)).toEqual(['项目', '工作/项目A', '生活/项目']);
  });

  it('命中位置来自打分器:连续命中 1 段、离散命中逐字成段', () => {
    const [contiguous] = completeMatch([tag('工作/项目A')], '项目');
    expect(contiguous.ranges).toEqual([{ start: 3, end: 5 }]); // 项(3) 目(4) 相邻 -> 一段
    const [discrete] = completeMatch([tag('工作/项目A')], '项A');
    expect(discrete.ranges).toEqual([{ start: 3, end: 4 }, { start: 5, end: 6 }]); // 项(3) A(5) -> 两段
  });

  it('未命中的标签项不出现;无匹配返回空', () => {
    expect(completeMatch([tag('生活/健身')], '项A')).toEqual([]);
    expect(completeMatch([tag('甲')], 'zzz')).toEqual([]);
  });

  it('同分按路径序定序(与候选传入顺序无关)', () => {
    const a = completeMatch([tag('乙/项目'), tag('甲/项目')], '项目');
    const b = completeMatch([tag('甲/项目'), tag('乙/项目')], '项目');
    // 码点序:乙 U+4E59 < 甲 U+7532
    expect(paths(a)).toEqual(['乙/项目', '甲/项目']);
    expect(paths(b)).toEqual(paths(a));
  });

  it('按 path 去重且标签优先(后端已去重,这里是防御)', () => {
    expect(completeMatch([alias('工作/项目A'), tag('工作/项目A')], '项A').map((r) => [r.path, r.kind]))
      .toEqual([['工作/项目A', 'tag']]);
    expect(paths(completeMatch([tag('工作'), tag('工作')], '工作'))).toEqual(['工作']);
  });

  it('固定项不插队:未命中即不出现,命中但分低仍按分排(只带 pinned 标记)', () => {
    expect(paths(completeMatch([tag('甲'), tag('乙')], '甲', { pinned: ['乙'] }))).toEqual(['甲']);
    const rows = completeMatch([tag('项目'), tag('工作/项目A')], '项目', { pinned: ['工作/项目A'] });
    expect(paths(rows)).toEqual(['项目', '工作/项目A']);
    expect(rows.map((r) => r.pinned)).toEqual([false, true]);
  });
});

describe('completeMatch 别名/近义项(G3/G4 语义保留)', () => {
  it('别名项不按 path 打分:路径与词元不同形也保留(别名 工作 -> 路径 职业/上班)', () => {
    const rows = completeMatch([tag('日期'), alias('职业/上班')], '工作');
    expect(rows.map((r) => [r.path, r.kind])).toEqual([['职业/上班', 'alias']]);
  });

  it('别名/近义项恒在标签命中之后,内部保持路径序,且不给高亮段', () => {
    // 若别名项也按 path 打分,路径 日漫 会拿前缀档冲到首位 —— 档位分必须低于任何真实命中分
    const rows = completeMatch([tag('追番/日漫合集'), alias('日漫'), similar('日漫速览')], '日漫');
    expect(rows.map((r) => [r.path, r.kind])).toEqual([
      ['追番/日漫合集', 'tag'],
      ['日漫', 'alias'],
      ['日漫速览', 'similar'],
    ]);
    expect(rows[0].ranges.length).toBeGreaterThan(0);
    expect(rows[1].ranges).toEqual([]);
    expect(rows[2].ranges).toEqual([]);
  });

  it('别名/近义项也计入展示上限', () => {
    const many = Array.from({ length: 3 }, (_, i) => similar(`近似${i}`));
    expect(paths(completeMatch(many, 'x', { limit: 2 }))).toEqual(['近似0', '近似1']);
  });
});

describe('completeMatch 空词元三档:固定项 -> 最近用过 -> 全量(设计 §3.5)', () => {
  it('三档顺序与 pinned 数组顺序', () => {
    const all = [tag('甲'), tag('乙'), tag('丙'), tag('丁')];
    const rows = completeMatch(all, '', {
      pinned: ['丁'],
      mru: [{ id: '乙', count: 3 }, { id: '丙', count: 1 }],
    });
    expect(paths(rows)).toEqual(['丁', '乙', '丙', '甲']);
    expect(rows.map((r) => r.pinned)).toEqual([true, false, false, false]);
    expect(rows.every((r) => r.ranges.length === 0)).toBe(true); // 空词元不给高亮
  });

  it('固定项按 pinned 数组顺序(与候选顺序无关),且不与最近档重复出现', () => {
    expect(paths(completeMatch([tag('甲'), tag('乙'), tag('丙')], '', { pinned: ['丙', '甲'] })))
      .toEqual(['丙', '甲', '乙']);
    const rows = completeMatch([tag('甲'), tag('乙')], '', { pinned: ['乙'], mru: [{ id: '乙', count: 9 }] });
    expect(paths(rows)).toEqual(['乙', '甲']);
    expect(rows[0].pinned).toBe(true);
  });

  it('最近档按次数降序;MRU 里不存在的 id 不占档位', () => {
    const rows = completeMatch([tag('甲'), tag('乙'), tag('丙')], '', {
      mru: [{ id: '丙', count: 1 }, { id: '乙', count: 5 }, { id: '已删除的标签', count: 99 }],
    });
    expect(paths(rows)).toEqual(['乙', '丙', '甲']);
  });

  it('全量档按路径序且上限 COMPLETE_LIMIT', () => {
    const many = Array.from({ length: 12 }, (_, i) => tag(`标签${String(i).padStart(2, '0')}`));
    expect(paths(completeMatch([...many].reverse(), ''))).toEqual(paths(completeMatch(many, '')));
    expect(paths(completeMatch(many, ''))).toEqual(many.slice(0, COMPLETE_LIMIT).map((t) => t.path));
  });
});

describe('sameList(输入事件里的 bail out 判据)', () => {
  const rows = (candidates: CompleteItem[], token: string): ReturnType<typeof completeMatch> =>
    completeMatch(candidates, token);

  it('长度、路径、来源、固定标记或高亮段不同 -> false', () => {
    expect(sameList([], [])).toBe(true);
    expect(sameList(rows([tag('甲')], ''), rows([tag('甲')], ''))).toBe(true);
    expect(sameList([], rows([tag('甲')], ''))).toBe(false);
    expect(sameList(rows([tag('甲')], ''), [])).toBe(false);
    expect(sameList(rows([tag('甲')], ''), rows([tag('乙')], ''))).toBe(false);
    // 空词元按路径序归一:候选传入顺序不影响结果,故不判为“变了”
    expect(sameList(rows([tag('甲'), tag('乙')], ''), rows([tag('乙'), tag('甲')], ''))).toBe(true);
    expect(sameList(rows([tag('甲')], ''), rows([tag('甲/子')], ''))).toBe(false);
    expect(sameList(rows([tag('工作/项目A')], '项A'), rows([alias('工作/项目A')], '项A'))).toBe(false);
    // 同一路径、同一来源,但高亮段不同(词元 项A -> 两段 / 词元 项 -> 一段)
    expect(sameList(rows([tag('工作/项目A')], '项A'), rows([tag('工作/项目A')], '项'))).toBe(false);
    // 固定标记不同
    expect(sameList(rows([tag('甲')], ''), completeMatch([tag('甲')], '', { pinned: ['甲'] }))).toBe(false);
  });
});
