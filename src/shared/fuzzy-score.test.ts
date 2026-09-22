/**
 * 模糊打分的共享向量断言(仓库根 `fixtures/fuzzy-score.json`)。
 *
 * `rawScore` 是关闭分层加权时的原始分,取自 VS Code `fuzzyScorer.ts`
 * (sha 62c8ac8ac5e0feaba1fa728fa48b10403f96ccab)实测 —— 权重漂移会立刻变红。
 * `tier` 断言默认分层打分的档位(前缀命中 > 包含命中)。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_QUERY_SCORE,
  LABEL_MATCH_BOOST,
  LABEL_PREFIX_BOOST,
  mergePositions,
  scoreFuzzy,
} from './fuzzy-score';

interface ScoreCase {
  why: string;
  query: string;
  target: string;
  positions: number[];
  rawScore?: number;
  tier?: 'prefix' | 'contains';
  noMatch?: boolean;
  neutral?: boolean;
}

interface RankCase {
  why: string;
  query: string;
  targets: string[];
  order: string[];
  miss?: string[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/fuzzy-score.json', import.meta.url), 'utf8'),
) as { cases: ScoreCase[]; ranking: RankCase[] };

/** 分隔符等价(反斜杠视同正斜杠),用于校验命中位置与查询一一对应 */
const norm = (text: string): string => text.toLowerCase().replace(/\\/g, '/');

describe('共享向量:权重与命中位置', () => {
  it('向量条数不少于 20(防止向量被悄悄删空)', () => {
    expect(fixture.cases.length + fixture.ranking.length).toBeGreaterThanOrEqual(20);
  });

  for (const c of fixture.cases) {
    const label = `${c.why} | query=${JSON.stringify(c.query)} target=${JSON.stringify(c.target)}`;
    it(label, () => {
      if (c.noMatch) {
        expect(scoreFuzzy(c.query, c.target, { boostTiers: false }), label).toEqual({ score: 0, positions: [] });
        expect(scoreFuzzy(c.query, c.target).score, label).toBe(0);
        return;
      }
      if (c.neutral) {
        expect(scoreFuzzy(c.query, c.target), label).toEqual({ score: EMPTY_QUERY_SCORE, positions: [] });
        return;
      }

      // 1) 原始权重分与命中位置必须与上游一致
      expect(scoreFuzzy(c.query, c.target, { boostTiers: false }), label).toEqual({
        score: c.rawScore,
        positions: c.positions,
      });

      // 2) 默认分 = 档位基数 + 前缀长度加权 + 原始分
      const prefix = c.tier === 'prefix';
      const base = prefix ? LABEL_PREFIX_BOOST : LABEL_MATCH_BOOST;
      const lengthBoost = prefix ? Math.round((c.query.length / c.target.length) * 100) : 0;
      expect(scoreFuzzy(c.query, c.target).score, label).toBe(base + lengthBoost + (c.rawScore ?? 0));

      // 3) 前缀命中高亮整段前缀,包含命中用回溯位置
      expect(scoreFuzzy(c.query, c.target).positions, label).toEqual(
        prefix ? c.positions.map((_, i) => i) : c.positions,
      );
    });
  }

  it('positions 与目标串下标一一对应(取字符可拼回查询)', () => {
    for (const c of fixture.cases) {
      if (!c.positions.length) continue;
      const picked = c.positions.map((pos) => c.target[pos]).join('');
      expect(norm(picked), c.why).toBe(norm(c.query));
    }
  });
});

describe('分层阈值', () => {
  it('前缀命中 > 包含命中,且包含命中不得跨档', () => {
    const prefix = scoreFuzzy('项A', '项A/子项');
    const contains = scoreFuzzy('项A', '工作/项目A');
    expect(prefix.score).toBeGreaterThanOrEqual(LABEL_PREFIX_BOOST);
    expect(contains.score).toBeGreaterThanOrEqual(LABEL_MATCH_BOOST);
    expect(contains.score).toBeLessThan(LABEL_PREFIX_BOOST);
    expect(prefix.score).toBeGreaterThan(contains.score);
  });

  it('档位差大于任意原始分,保证跨档顺序不被原始分翻转', () => {
    const maxRaw = Math.max(...fixture.cases.map((c) => c.rawScore ?? 0));
    expect(LABEL_PREFIX_BOOST).toBeGreaterThan(LABEL_MATCH_BOOST + maxRaw);
  });

  it('阈值常量取自 VS Code(1<<17 / 1<<16)', () => {
    expect(LABEL_PREFIX_BOOST).toBe(1 << 17);
    expect(LABEL_MATCH_BOOST).toBe(1 << 16);
  });
});

describe('选项', () => {
  it('allowNonContiguous:false 只接受连续子串', () => {
    expect(scoreFuzzy('项A', '工作/项目A', { allowNonContiguous: false }).score).toBe(0);
    expect(scoreFuzzy('项目', '工作/项目A', { allowNonContiguous: false, boostTiers: false }).positions).toEqual([3, 4]);
  });
});

describe('共享向量:排序', () => {
  for (const c of fixture.ranking) {
    it(c.why, () => {
      const scored = c.targets.map((target) => ({ target, ...scoreFuzzy(c.query, target) }));
      const pick = (target: string): number => scored.find((s) => s.target === target)?.score ?? -1;

      for (const miss of c.miss ?? []) {
        expect(pick(miss), `${miss} 不应命中 ${c.query}`).toBe(0);
      }

      const ranked = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.target);
      expect(ranked).toEqual(c.order);

      // 顺序必须是严格递减,不靠稳定排序兜底
      for (let i = 1; i < ranked.length; i++) {
        expect(pick(ranked[i - 1]), `${ranked[i - 1]} > ${ranked[i]}`).toBeGreaterThan(pick(ranked[i]));
      }

      // 高亮位置与排序同源:命中位置数等于查询长度
      for (const row of scored.filter((s) => s.score > 0)) {
        expect(row.positions.length, `${row.target} 的命中数`).toBe(c.query.length);
      }
    });
  }
});

describe('mergePositions:相邻下标合并成段', () => {
  it('连续下标合成一段', () => {
    expect(mergePositions([0, 1, 2, 3, 5])).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 6 },
    ]);
  });

  it('全离散保持单体段(供 <mark> 逐字高亮)', () => {
    expect(mergePositions([0, 2, 4])).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
      { start: 4, end: 5 },
    ]);
  });

  it('空输入给空段', () => {
    expect(mergePositions([])).toEqual([]);
  });

  it('与打分器串联:段内字符拼回查询', () => {
    const target = '工作/项目A';
    const ranges = mergePositions(scoreFuzzy('项A', target).positions);
    expect(ranges.map(({ start, end }) => target.slice(start, end)).join('')).toBe('项A');
  });
});
