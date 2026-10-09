/**
 * 标签名行内 md(T1)的**高亮下标重定位**(唯一真源,两个显示位共用):
 * 打分器给的命中下标基于**原始路径**(`地点/[郴](chēn)州市`),而显示位是 `tagLabelPlain`
 * 去掉语法后的纯文本(`地点/郴州市`)—— 下标整体错位,必须重定位。
 *
 * 纪律:**宁可少标,不可标错位**。逐段把原文切片在 plain 里按顺序找回落点,任一段找不到
 * (命中跨过被去掉的语法符号)就整条退化为「不细分高亮」,不猜、不近似对齐。
 * 无 md 语法时 plain === raw,原样透传(既有行为不变)。
 *
 * 两个消费方:
 * - `input-bar/TagCompleteList.tsx`(完整路径 + 父/末级分色):用 `remapRanges`;
 * - `palette/providers/entities.ts`(统一输入框 `#` 档候选):打分器给的是单点下标,用 `remapPositions`。
 */
import type { MatchRange } from './fuzzy-score';

/** 原始路径上的高亮段 -> 纯文本上的高亮段;任一段落不到就返回空(整条不细分高亮) */
export function remapRanges(raw: string, plain: string, ranges: readonly MatchRange[]): MatchRange[] {
  if (plain === raw) return [...ranges];
  const out: MatchRange[] = [];
  let from = 0;
  for (const r of ranges) {
    const slice = raw.slice(r.start, r.end);
    const at = slice === '' ? -1 : plain.indexOf(slice, from);
    if (at < 0) return [];
    out.push({ start: at, end: at + slice.length });
    from = at + slice.length;
  }
  return out;
}

/**
 * 单点命中下标(打分器 positions)的重定位:逐点当成长度 1 的段,交给 `remapRanges` ——
 * 与上面同一实现、同一退化口径(任一点落不到就整条返回空)。
 * positions 由打分器给出且升序,故合并成一批段后仍满足 remapRanges 的「顺序回落」前提。
 */
export function remapPositions(raw: string, plain: string, positions: readonly number[]): number[] {
  if (plain === raw) return [...positions];
  const ranges = remapRanges(raw, plain, positions.map((p) => ({ start: p, end: p + 1 })));
  return ranges.length === positions.length ? ranges.map((r) => r.start) : [];
}
