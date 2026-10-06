/**
 * 标签关系的纯格式化(标签关系统一 spec §7):树行小字、悬浮卡片共用一份口径。
 *
 * 一条边读作「本标签具有「属性名」所表示的属性」;属性名就是 `RelationRef.remark`,
 * **存在边上**(迁移 023) —— 不是目标标签名字里的 md 备注(`[国籍](国别)` 的 `国别`,
 * 那只驱动标签名的悬浮显示)。同一个目标标签可承担多个属性名(国籍 / 出生地)。
 * 行内/卡片显示 `属性名 → 目标`;属性名为空时回退只显示目标名(R12:不能显示成空,
 * 让人不知道这条边什么意思)。
 */
import { tagLabelPlain } from './tag-label';
import type { RelationRef } from './types';

/** 树行内最多显示几条关系,超出用 `+N` 概括 */
export const MAX_RELATION_CHIPS = 2;

/** 一条关系小字:有属性名 `属性名 → 目标`,属性名为空回退目标名 */
export function relationLabel(r: RelationRef): string {
  const target = tagLabelPlain(r.name);
  const remark = tagLabelPlain(r.remark);
  return remark === '' ? target : `${remark} → ${target}`;
}

/** 行内截断计划:最多 max 条 + 余数 `+N`(顺序按传入原序) */
export function relationPlan<T>(relations: readonly T[], max = MAX_RELATION_CHIPS): { shown: T[]; extra: number } {
  return { shown: relations.slice(0, max), extra: Math.max(0, relations.length - max) };
}

/**
 * 悬浮卡片文案(多行):第一行沿用既有「路径(本级 N / 含子级 M)」,
 * 有关系时追加一行 `关系：属性名 → 目标、…`(列出全部,不受行内 2 条上限约束);无关系不出该行。
 */
export function tagFactsTitle(
  path: string,
  selfCount: number,
  subtreeCount: number,
  relations: readonly RelationRef[]
): string {
  const lines = [`${tagLabelPlain(path)}(本级 ${selfCount} / 含子级 ${subtreeCount})`];
  if (relations.length > 0) lines.push(`关系：${relations.map(relationLabel).join('、')}`);
  return lines.join('\n');
}
