/**
 * 标签关系的纯格式化(点/线模型 v31):树行小字、悬浮档案卡片共用一份口径。
 *
 * 一条线读作「被引用点 `toTagId` 上有一条名为 `nameText` 的线」—— 名字存在**点**上
 * (`lines.name_id` 指向名字点),不再存在线上;同一个被引用点可有多条不同名字的线
 * (国籍 / 出生地)。
 *
 * 本文件只做文本格式化,不碰 id;`RelationRef` 的 id 字段(`toTagId` / `nameId`)是**点 id**
 * (`nameId` 是线上的名字点),由调用方按同一命名空间去匹配可见节点。
 *
 * 显示分三层(2026-10-06 用户口径:「国籍 → 中国大陆」变成「中国大陆」):
 * - 行内小字 `relationValue` = **只显示值**(如 `中国大陆`),不拼箭头与名字
 * - 悬停这个值 `relationValueTip` = 名字(空 = 调用方不挂 data-tip,回退成行级卡片)
 * - 悬停标签名 `tagLeafName`(卡片标题,末段名)+ `tagFactsRows`(档案:一条关系一行,左名字右值)
 */
import { tagLabelPlain } from './tag-label';
import type { RelationRef } from './types';

/** 树行内最多显示几条关系,超出用 `+N` 概括 */
export const MAX_RELATION_CHIPS = 2;

/** 一条线的名字文本(显示口径):v31 认名字点上的 `nameText`;空串 = 无名字线 */
function lineName(r: RelationFactLike): string {
  return tagLabelPlain(r.nameText ?? '');
}

/** 菜单等「一条关系写成一句」的场合仍在用:有名字 `名字 → 被引用点`,无名字回退被引用点名 */
export function relationLabel(r: RelationRef): string {
  const target = tagLabelPlain(r.name);
  const name = lineName(r);
  return name === '' ? target : `${name} → ${target}`;
}

/** 行内小字 = 只显示值(被引用点标签名,剥掉行内 md) */
export function relationValue(r: RelationFactLike): string {
  return tagLabelPlain(r.name);
}

/** 值上的悬停提示 = 名字;无名字线给空串(调用方据此不挂 data-tip,R12 不留空提示) */
export function relationValueTip(r: RelationFactLike): string {
  return lineName(r);
}

/**
 * 行内按**名字 + 值**去重(v31 语义):行内要显示「名字 + 值」,同值不同名(国籍/出生地
 * 都指 `中国大陆`)两条都要显示;只有名字与值都相同才算重复。卡片不走这里 —— 档案里两条都要列。
 */
export function uniqueRelationValues(relations: readonly RelationRef[]): RelationRef[] {
  const seen = new Set<string>();
  const out: RelationRef[] = [];
  for (const r of relations) {
    const key = `${tagLabelPlain(r.nameText ?? '')}\u0000${relationValue(r)}`;
    if (seen.has(key)) continue;
    seen.add(key);
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

/** 关系行的最小投影面(标签事实与图上的关系线都满足):目标名 + 线上的名字(名字点 `nameText`) */
export interface RelationFactLike {
  name: string;
  /** v31 名字点文本(无名字线为空串) */
  nameText?: string;
}

/** 档案卡片的关系行:**每条关系一行**(不去重);线没有名字时左列回退显示目标名(R12) */
export function tagFactsRows(relations: readonly RelationFactLike[]): FactRow[] {
  return relations.map((r) => {
    const value = relationValue(r);
    const label = relationValueTip(r);
    return label === '' ? { label: value, value: '' } : { label, value };
  });
}
