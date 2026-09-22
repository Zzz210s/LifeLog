/**
 * 前缀命中的**位置策略**真测试(T2 审查 I1 遗留)。
 *
 * 策略(实现 `fuzzy-score.ts:171`,上游 `fuzzyScorer.ts:531` 同源):查询是目标串真前缀时,
 * 高亮取**整段前缀** `[0..q-1]`,而 DP 回溯出来的位置只用于算分 —— 二者**不等价**,
 * 分隔符加分可能让 DP 走另一条路径。这里用一条特征化用例把两种取值同时钉住,
 * 防止有人"顺手改成 raw.positions"却全绿放行(变异 M9)。
 */
import { describe, expect, it } from 'vitest';
import { LABEL_PREFIX_BOOST, scoreFuzzy } from './fuzzy-score';

const TARGET = '作aA工.a作/AB作B'; // 12 字符,下标 8 的 'A' 前面是 '/'(分隔符 +5)
const QUERY = '作A';

describe('前缀命中:高亮取整段前缀', () => {
  it('查询是真前缀时 positions 为 [0..q-1](不依赖 DP 结果)', () => {
    const result = scoreFuzzy(QUERY, TARGET);
    expect(result.positions).toEqual([0, 1]);
    // 默认分 = 前缀档基数 + 前缀长度加权 round(2/12*100) + 原始分 17
    expect(result.score).toBe(LABEL_PREFIX_BOOST + Math.round((2 / TARGET.length) * 100) + 17);
  });

  it('大小写错位的前缀同样整段高亮', () => {
    expect(scoreFuzzy('Ab', 'aBc').positions).toEqual([0, 1]);
    expect(scoreFuzzy('项A', '项A/子项').positions).toEqual([0, 1]);
  });

  it('特征化:DP 最优路径是 [0,8],高亮仍是 [0,1](与上游同源,刻意保留)', () => {
    // t[8]='A' 前有 '/'(+5 分隔符)且大小写相同(+1),DP 路径得分 10+7=17;
    // 而前缀区间 [0,1] 的 'a' 大小写不同、前面无分隔符,那条路径只值 10+1=11。
    // 于是分数来自 DP 最优路径、高亮来自前缀区间,二者指向不同下标 —— 上游固有行为,非缺陷。
    expect(scoreFuzzy(QUERY, TARGET, { boostTiers: false })).toEqual({ score: 17, positions: [0, 8] });
    expect(scoreFuzzy(QUERY, TARGET).positions).toEqual([0, 1]);
    // 两串位置都能大小写不敏感地拼回查询;高亮取 [0,1] 更贴近真实前缀(大小写错位但连成一段)
    const norm = (text: string): string => text.toLowerCase();
    expect(norm([0, 1].map((i) => TARGET[i]).join(''))).toBe(norm(QUERY));
    expect(norm([0, 8].map((i) => TARGET[i]).join(''))).toBe(norm(QUERY));
  });
});
