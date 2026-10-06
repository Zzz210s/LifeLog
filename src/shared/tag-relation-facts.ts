/**
 * 标签关系的纯格式化(标签关系统一 spec §7):树行小字、悬浮档案卡片共用一份口径。
 *
 * 一条边读作「本标签具有「属性名」所表示的属性」;属性名就是 `RelationRef.remark`,
 * **存在边上**(迁移 023) —— 不是目标标签名字里的 md 备注(`[国籍](国别)` 的 `国别`,
 * 那只驱动标签名的悬浮显示)。同一个目标标签可承担多个属性名(国籍 / 出生地)。
 *
 * 显示分三层(2026-10-06 用户口径:「国籍 → 中国大陆」变成「中国大陆」):
 * - 行内小字 `relationValue` = **只显示值**(如 `中国大陆`),不拼箭头与属性名
 * - 悬停这个值 `relationValueTip` = 属性名(空 = 调用方不挂 data-tip,回退成行级卡片)
 * - 悬停标签名 `tagLeafName`(卡片标题,末段名)+ `tagFactsRows`(档案:一条关系一行,左属性名右值)
 */
import { tagLabelPlain } from './tag-label';
import type { RelationRef } from './types';

/** 树行内最多显示几条关系,超出用 `+N` 概括 */
export const MAX_RELATION_CHIPS = 2;

/** 菜单等「一条关系写成一句」的场合仍在用:有属性名 `属性名 → 目标`,属性名为空回退目标名 */
export function relationLabel(r: RelationRef): string {
  const target = tagLabelPlain(r.name);
  const remark = tagLabelPlain(r.remark);
  return remark === '' ? target : `${remark} → ${target}`;
}

/** 行内小字 = 只显示值(目标标签名,剥掉行内 md) */
export function relationValue(r: RelationFactLike): string {
  return tagLabelPlain(r.name);
}

/** 值上的悬停提示 = 属性名;边上没有属性名给空串(调用方据此不挂 data-tip,R12 不留空提示) */
export function relationValueTip(r: RelationFactLike): string {
  return tagLabelPlain(r.remark);
}

/**
 * 行内按**显示值**去重(同值多属性只留第一条):行内只显示值,重复值没有信息量。
 * 卡片不走这里 —— 档案里 国籍/出生地 都指向 中国大陆 时两条都要列。
 */
export function uniqueRelationValues(relations: readonly RelationRef[]): RelationRef[] {
  const seen = new Set<string>();
  const out: RelationRef[] = [];
  for (const r of relations) {
    const value = relationValue(r);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(r);
  }
  return out;
}

/** 行内截断计划:最多 max 条 + 余数 `+N`(顺序按传入原序) */
export function relationPlan<T>(relations: readonly T[], max = MAX_RELATION_CHIPS): { shown: T[]; extra: number } {
  return { shown: relations.slice(0, max), extra: Math.max(0, relations.length - max) };
}

/** 档案卡片里的一行:左列属性名(muted)、右列值 */
export interface FactRow {
  label: string;
  value: string;
}

/** 卡片标题 = 标签**末段名**(纯文本,不带路径前缀)。
 *  取末段在剥 md **之后**:`作者/[冯骥才](作家)` -> `冯骥才`(斜杠是段分隔符,链接语法不跨段)。 */
export function tagLeafName(path: string): string {
  const plain = tagLabelPlain(path);
  const at = plain.lastIndexOf('/');
  return at < 0 ? plain : plain.slice(at + 1);
}

/** 关系行的最小投影面(标签事实与图上的关系边都满足):只要能给出目标名与边上的属性名 */
export interface RelationFactLike {
  name: string;
  remark: string;
}

/** 档案卡片的关系行:**每条关系一行**(不去重);边上没属性名时左列回退显示目标名(R12) */
export function tagFactsRows(relations: readonly RelationFactLike[]): FactRow[] {
  return relations.map((r) => {
    const value = relationValue(r);
    const label = relationValueTip(r);
    return label === '' ? { label: value, value: '' } : { label, value };
  });
}
