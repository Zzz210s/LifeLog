/**
 * 补全候选池的**唯一实体池**(计划 T3.2):`#` 补全与 `[[ ]]` 补全共用同一个池,
 * 差别只在收窄口径 —— 树内实体(present 于渲染闭包,`path` 非空)与全部实体。
 *
 * 数据仍是既有两条 IPC(契约不变):
 * - `complete_notes` -> 全部实体的显示首行(`meta` 首行,也是 `[[X]]` 寻址用的名字);
 * - `list_tags` -> 树内实体(`path IS NOT NULL`;取渲染闭包,不是裸 `is_cited`)。
 * 本模块只做纯合并:不取数、不打分、不持有 MRU。
 */
import type { NoteTitle, TagCount } from './types';

/** 池里的一项实体:树内实体带路径(`#X` 采纳写入路径),所有实体都有名字(`[[X]]` 采纳写入名字) */
export interface EntityCandidate {
  readonly id: number;
  /** 显示首行(`meta` 首行):`[[X]]` 采纳与寻址用的名字 */
  readonly name: string;
  /** 树内路径;树外为 null —— 「在树内」的判定就是这个字段非空(与树渲染闭包同口径) */
  readonly path: string | null;
}

/** 是否在树内:唯一判据是闭包给的路径字段,不是裸引用计数 */
export function isInTree(e: EntityCandidate): boolean {
  return e.path !== null;
}

/** 路径末段(树内实体缺显示首行时的兜底;统一实体后标签 meta 就是末段名) */
function leafName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? path : path.slice(cut + 1);
}

/** 树内实体池:`list_tags` 的每一行都是闭包成员(含零引用的自动中间节点) */
export function treePool(rows: readonly TagCount[]): EntityCandidate[] {
  return rows.map((r) => ({ id: r.id, name: leafName(r.path), path: r.path }));
}

/**
 * 全部实体池:以 `complete_notes`(全部实体的显示首行)为骨架,树内行用 `list_tags` 的路径补 path。
 * 两侧 id 空间同源(统一实体表),按 id 归并;骨架缺失的树内行也并进来(并集不丢)。
 */
export function mergeEntityPool(
  titles: readonly NoteTitle[],
  tree: readonly TagCount[],
): EntityCandidate[] {
  const byId = new Map<number, EntityCandidate>();
  for (const t of titles) byId.set(t.id, { id: t.id, name: t.title, path: null });
  for (const r of tree) {
    const cur = byId.get(r.id);
    byId.set(r.id, { id: r.id, name: cur?.name ?? leafName(r.path), path: r.path });
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** 徽标文案的唯一真源:树内 / 树外 */
export function entityBadge(inTree: boolean): '树内' | '树外' {
  return inTree ? '树内' : '树外';
}
