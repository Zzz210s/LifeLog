// 共现：同一篇笔记里一起出现的两个实体（标签/关系目标/链接），互相记一次。
// 插件把结果写进实体笔记的受管区块，Obsidian 原生关系图就会画出「实体 ↔ 实体」的直边。
import { PointRecord } from './schema';

export type Pair = { a: string; b: string; weight: number };

export const BLOCK_START = '<!-- lifelog:cooccur:start -->';
export const BLOCK_END = '<!-- lifelog:cooccur:end -->';

const TAG = /(?:^|\s)#([^\s#[\]]+)/g;
const LINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

/** 一篇笔记里出现的全部「实体名」，去重后返回。 */
export function targetsOf(r: PointRecord): string[] {
  const set = new Set<string>();
  for (const m of r.body.matchAll(TAG)) set.add(m[1]);
  for (const m of r.body.matchAll(LINK)) set.add(m[1].trim());
  for (const rel of r.relations) set.add(rel.to);
  return [...set].filter((t) => t.length > 0);
}

/** 全库共现对（无序，a < b 保证稳定），按权重降序。 */
export function cooccurrence(records: PointRecord[], minWeight = 2): Pair[] {
  const weights = new Map<string, number>();
  for (const r of records) {
    const ts = targetsOf(r).sort();
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        const key = `${ts[i]}\u0000${ts[j]}`;
        weights.set(key, (weights.get(key) ?? 0) + 1);
      }
    }
  }
  const pairs: Pair[] = [];
  for (const [key, weight] of weights) {
    if (weight < minWeight) continue;
    const [a, b] = key.split('\u0000');
    pairs.push({ a, b, weight });
  }
  return pairs.sort((x, y) => y.weight - x.weight || x.a.localeCompare(y.a));
}

/** 某个实体在共现对里的邻居，按权重降序。 */
export function neighborsOf(pairs: Pair[], entity: string, limit = 20): Pair[] {
  return pairs.filter((p) => p.a === entity || p.b === entity).slice(0, limit);
}

/** 生成受管区块内容（含权重注释，图上不显示权重是 Obsidian 的硬限制）。 */
export function renderBlock(pairs: Pair[], entity: string): string {
  const lines = pairs.map((p) => {
    const other = p.a === entity ? p.b : p.a;
    return `- [[${other}]] <!-- w${p.weight} -->`;
  });
  return [BLOCK_START, '## 共现', ...(lines.length ? lines : ['- 无']), BLOCK_END].join('\n');
}

/** 幂等写入：已有区块就整体替换，没有就追加到文末。 */
export function upsertBlock(body: string, block: string): string {
  const start = body.indexOf(BLOCK_START);
  const end = body.indexOf(BLOCK_END);
  if (start >= 0 && end > start) {
    return body.slice(0, start) + block + body.slice(end + BLOCK_END.length);
  }
  const trimmed = body.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}
