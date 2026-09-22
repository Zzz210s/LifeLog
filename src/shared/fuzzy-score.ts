/**
 * 模糊打分引擎:命令 / 笔记 / 标签三处共用(排序与高亮必须同源)。
 *
 * 权重逐项照抄 VS Code `src/vs/base/common/fuzzyScorer.ts`
 * (sha 62c8ac8ac5e0feaba1fa728fa48b10403f96ccab):字符命中 +1;连续序列第 2 个起前 3 个
 * ×6 其余 ×3(序列首字符无连续加分);同大小写 +1;词首 +8;分隔符后 `/` `\` 给 +5,
 * `.` `-` `_` 空格 `'` `"` `:` 给 +4;驼峰大写(非连续序列中,ASCII A-Z)+2。
 * 命中位置由本模块给出,调用方不得另写 matcher。
 */

/** 分层档位:前缀命中整档高于包含命中(VS Code LABEL_PREFIX_SCORE_THRESHOLD / LABEL_SCORE_THRESHOLD) */
export const LABEL_PREFIX_BOOST = 1 << 17;
export const LABEL_MATCH_BOOST = 1 << 16;
/** 空查询的中性分:视为全部命中但不加权,排序保持稳定 */
export const EMPTY_QUERY_SCORE = 1;

export interface FuzzyScoreOptions {
  /** 是否叠加分层档位(前缀 > 包含)。默认 true;false 时返回 VS Code 原始权重分,供权重对照 */
  boostTiers?: boolean;
  /** 是否允许非连续匹配。默认 true(tag 路径补全必须允许;false 只接受连续子串) */
  allowNonContiguous?: boolean;
}

export interface FuzzyScoreResult {
  score: number;
  /** 命中的目标串下标(升序,每个查询字符一项);无命中为空数组 */
  positions: number[];
}

/** 命中段,end 不含(供 `<mark>` 渲染) */
export interface MatchRange {
  start: number;
  end: number;
}

const NO_MATCH = 0;

/** 分隔符编码:`/` 与 `\` 优先于其他分隔符 */
const PATH_SEPARATORS = new Set<number>([0x2f, 0x5c]);
const OTHER_SEPARATORS = new Set<number>([0x2e, 0x2d, 0x5f, 0x20, 0x27, 0x22, 0x3a]);

function isUpperCode(code: number): boolean {
  return code >= 0x41 && code <= 0x5a; // ASCII A-Z(中文不属于大写)
}

function separatorBonus(charCode: number): number {
  if (PATH_SEPARATORS.has(charCode)) return 5;
  if (OTHER_SEPARATORS.has(charCode)) return 4;
  return 0;
}

/** 字符等价:相同,或两个平台路径分隔符(照抄 VS Code considerAsEqual) */
function charsEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (a === '/' || a === '\\') return b === '/' || b === '\\';
  return false;
}

/** 单字符得分(照抄 VS Code computeCharScore) */
function charScore(
  queryChar: string,
  queryLowerChar: string,
  target: string,
  targetLower: string,
  targetIndex: number,
  sequenceLength: number,
): number {
  if (!charsEqual(queryLowerChar, targetLower[targetIndex])) return 0;

  let score = 1;
  // 连续序列:前 3 个 ×6,其余 ×3
  if (sequenceLength > 0) {
    score += Math.min(sequenceLength, 3) * 6 + Math.max(0, sequenceLength - 3) * 3;
  }
  // 同大小写
  if (queryChar === target[targetIndex]) score += 1;

  if (targetIndex === 0) {
    score += 8; // 词首
  } else {
    const separator = separatorBonus(target.charCodeAt(targetIndex - 1));
    if (separator) score += separator;
    else if (isUpperCode(target.charCodeAt(targetIndex)) && sequenceLength === 0) score += 2; // 驼峰
  }

  return score;
}

/** 打分矩阵 + 回溯取命中位置(照抄 VS Code doScoreFuzzy) */
function scoreRaw(
  query: string,
  queryLower: string,
  target: string,
  targetLower: string,
  allowNonContiguous: boolean,
): FuzzyScoreResult {
  const queryLength = query.length;
  const targetLength = target.length;
  const scores = new Array<number>(queryLength * targetLength).fill(0);
  const matches = new Array<number>(queryLength * targetLength).fill(NO_MATCH);

  for (let queryIndex = 0; queryIndex < queryLength; queryIndex++) {
    const offset = queryIndex * targetLength;
    const previousOffset = offset - targetLength;
    const queryChar = query[queryIndex];
    const queryLowerChar = queryLower[queryIndex];

    for (let targetIndex = 0; targetIndex < targetLength; targetIndex++) {
      const currentIndex = offset + targetIndex;
      const hasPrevious = queryIndex > 0 && targetIndex > 0;

      const leftScore = targetIndex > 0 ? scores[currentIndex - 1] : 0;
      const diagonalScore = hasPrevious ? scores[previousOffset + targetIndex - 1] : 0;
      const sequenceLength = hasPrevious ? matches[previousOffset + targetIndex - 1] : 0;

      // 第 2 个查询字符起,必须沿对角线有前序命中(保证按序匹配)
      const score =
        !diagonalScore && queryIndex > 0
          ? 0
          : charScore(queryChar, queryLowerChar, target, targetLower, targetIndex, sequenceLength);

      const allowed = allowNonContiguous || queryIndex > 0 || targetLower.startsWith(queryLower, targetIndex);

      if (score > 0 && diagonalScore + score >= leftScore && allowed) {
        matches[currentIndex] = sequenceLength + 1;
        scores[currentIndex] = diagonalScore + score;
      } else {
        matches[currentIndex] = NO_MATCH;
        scores[currentIndex] = leftScore;
      }
    }
  }

  // 从矩阵右下角回溯:未命中向左,命中则向左上并记下目标下标
  const positions: number[] = [];
  let queryIndex = queryLength - 1;
  let targetIndex = targetLength - 1;
  while (queryIndex >= 0 && targetIndex >= 0) {
    if (matches[queryIndex * targetLength + targetIndex] === NO_MATCH) targetIndex--;
    else {
      positions.push(targetIndex);
      queryIndex--;
      targetIndex--;
    }
  }

  return { score: scores[queryLength * targetLength - 1], positions: positions.reverse() };
}

/** 打分:返回分数与命中位置(无命中为 0 分空位置;空查询给中性分) */
export function scoreFuzzy(query: string, target: string, opts: FuzzyScoreOptions = {}): FuzzyScoreResult {
  const { boostTiers = true, allowNonContiguous = true } = opts;

  if (!query) return { score: EMPTY_QUERY_SCORE, positions: [] };
  if (!target || target.length < query.length) return { score: 0, positions: [] };

  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();
  const raw = scoreRaw(query, queryLower, target, targetLower, allowNonContiguous);
  if (raw.score === 0) return { score: 0, positions: [] };
  if (!boostTiers) return raw;

  // 前缀命中整档抬升,并在同档内让短标签优先(照抄 VS Code prefixLengthBoost)
  if (!targetLower.startsWith(queryLower)) {
    return { score: LABEL_MATCH_BOOST + raw.score, positions: raw.positions };
  }

  const lengthBoost = Math.round((query.length / target.length) * 100);
  return {
    score: LABEL_PREFIX_BOOST + lengthBoost + raw.score,
    positions: Array.from({ length: query.length }, (_, i) => i),
  };
}

/** 把升序的命中下标合并成连续段(相邻合并),供 `<mark>` 渲染 */
export function mergePositions(positions: number[]): MatchRange[] {
  const ranges: MatchRange[] = [];
  let last: MatchRange | undefined;

  for (const position of positions) {
    if (last && last.end === position) last.end += 1;
    else {
      last = { start: position, end: position + 1 };
      ranges.push(last);
    }
  }

  return ranges;
}
