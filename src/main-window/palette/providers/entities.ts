/**
 * 实体 provider(计划 T3.2):把原「笔记池 / 标签池」两个 provider 合并成**一个实体 provider** ——
 * 候选来自同一个实体池(`shared/entity-pool`),差别只在收窄:
 * - `#`(引用):只取**树内实体**,行 id = 路径(采纳走 `#路径`);
 * - `@`(打开)/ 默认档:取**全部实体**,行 id = 实体 id 的字符串形。
 * 打分沿用共享 `fuzzy-score`(与命令 provider 同引擎);空查询不带分数,交给列表模型三档。
 */
import { PATH_BOOST, scoreFuzzy } from '../../../shared/fuzzy-score';
import { isInTree } from '../../../shared/entity-pool';
import type { EntityCandidate } from '../../../shared/entity-pool';
import type { QuickPickItem } from '../../../shared/quickpick/model';
import type { QuickPickProvider } from '../../../shared/quickpick/providers';
import { tagLabelPlain } from '../../../shared/tag-label';
import { remapPositions } from '../../../shared/tag-label-highlight';
import type { TagCount } from '../../../shared/types';
import type { RowDecoration } from '../PaletteRow';

export const ENTITIES_PREFIX = '';
export const ENTITIES_OPEN_PREFIX = '@';
export const ENTITIES_TREE_PREFIX = '#';
export const ENTITIES_PROVIDER_ID = 'entities';
export const ENTITIES_OPEN_PROVIDER_ID = 'entities-open';
export const ENTITIES_TREE_PROVIDER_ID = 'entities-tree';
/** 与笔记 provider 同一硬上限(设计 §3.3 QUICK_OPEN_LIMIT) */
export const ENTITY_CANDIDATE_LIMIT = 200;

/** 一行的采纳目标 id:`#` 用路径(树内实体),其余用实体 id */
function rowId(e: EntityCandidate, inTreeOnly: boolean): string {
  return inTreeOnly ? (e.path ?? e.name) : String(e.id);
}

/** 打分与展示用的原始串:`#` 用路径(能看出层级),其余用显示首行(`[[X]]` 同口径) */
function rowRaw(e: EntityCandidate, inTreeOnly: boolean): string {
  return inTreeOnly ? (e.path ?? e.name) : e.name;
}

/** 树内行按路径序(与旧标签 provider 的全量档同序);全部实体保持实体 id 序 */
function ordered(rows: readonly EntityCandidate[], inTreeOnly: boolean): readonly EntityCandidate[] {
  if (!inTreeOnly) return rows;
  return [...rows].sort((a, b) => ((a.path ?? '') < (b.path ?? '') ? -1 : 1));
}

/** 候选 -> 列表项:空查询按池序;有查询按分降序,未命中不出现。
 *  `#` 的展示文案走 `tagLabelPlain`(标签名里的行内 md 是备注,不摆进候选),
 *  高亮下标按同一映射重定位(与旧 tags provider 同口径)。 */
export function entityItems(
  pool: readonly EntityCandidate[],
  query: string,
  inTreeOnly: boolean,
): QuickPickItem[] {
  const rows = ordered(inTreeOnly ? pool.filter(isInTree) : pool, inTreeOnly);
  const q = query.trim();
  const out: QuickPickItem[] = [];
  for (const e of rows) {
    const raw = rowRaw(e, inTreeOnly);
    const label = inTreeOnly ? tagLabelPlain(raw) : raw;
    const id = rowId(e, inTreeOnly);
    if (q === '') {
      out.push({ id, label });
      continue;
    }
    // boostTiers:false —— 档位由本 provider 叠加,免得 scorer 再压一层
    const hit = scoreFuzzy(q, raw, { boostTiers: false });
    if (hit.score <= 0) continue;
    out.push({
      id,
      label,
      score: PATH_BOOST + hit.score,
      positions: inTreeOnly ? remapPositions(raw, label, hit.positions) : hit.positions,
    });
  }
  if (q !== '') out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return out.slice(0, ENTITY_CANDIDATE_LIMIT);
}

export interface EntityProviderOptions {
  /** 取实体池(host 注入;失败原样抛,由浮层落错误条) */
  getPool: () => Promise<readonly EntityCandidate[]>;
  /** true = 只取树内实体(`#` 前缀) */
  inTreeOnly: boolean;
  prefix: string;
  id: string;
}

/** 行右侧副文本:含子级计数(`#` 档装饰;自旧 tags provider 迁入,口径不变) */
export function tagDecorations(tags: readonly TagCount[]): Record<string, RowDecoration> {
  const out: Record<string, RowDecoration> = {};
  for (const tag of tags) out[tag.path] = { detail: `${tag.subtree_count} 条` };
  return out;
}

/** 注册表条目(一个模块注册三次:默认档 / `@` / `#`) */
export function createEntityProvider(options: EntityProviderOptions): QuickPickProvider {
  return {
    prefix: options.prefix,
    id: options.id,
    getItems: async (query: string) =>
      entityItems(await options.getPool(), query, options.inTreeOnly),
  };
}
