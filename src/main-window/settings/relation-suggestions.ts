/**
 * 标签关系建议(标签关系统一 spec §9,规则沿用 2026-10-05-tag-types-design.md §6)。
 *
 * 这是**启发式,不是语义判断**:规则只看标签在树里的路径与层级,库里没有"中国到底是
 * 所在还是产地"的证据,误推必然存在(R10)。所以本模块只产出建议,写库由面板在人工
 * 确认后才触发(R6:绝不自动写);每条建议都带一句依据文案,让人能判断它从哪来。
 *
 * 规则集中在本文件:新增/调整只改 SUGGESTION_RULES,面板与测试都从这里取数。
 */
import type { TagCount } from '../../shared/types';

export interface RelationSuggestion {
  tagId: number;
  tagPath: string;
  /** 建议建立关系的目标标签 id(必须是真实存在的标签,否则该条不产出) */
  toTagId: number;
  /** 目标名(目标标签路径末段) */
  toName: string;
  /** 依据文案:面板逐条显示 */
  basis: string;
}

interface SuggestionRule {
  /** 建议指向的目标标签路径;该标签不存在时此规则静默失效 */
  toPath: string;
  basis: string;
  /** 按路径分段判定(目标标签自身不参与,故不会自己建议自己) */
  match: (parts: string[]) => boolean;
}

const under =
  (root: string) =>
  (parts: string[]): boolean =>
    parts[0] === root && parts.length >= 2;

/** 四位数年份且挂在 时间 的子级下(如 时间/出版年份/1930);时间/2026 的父级是 时间 本身,不算 */
const yearUnderTime = (parts: string[]): boolean =>
  parts.length === 3 && parts[0] === '时间' && /^[0-9]{4}$/.test(parts[2] ?? '');

export const SUGGESTION_RULES: readonly SuggestionRule[] = [
  { toPath: '地点轴/所在', basis: '来自路径 地点/*', match: under('地点') },
  { toPath: '作者', basis: '来自路径 作者/*', match: under('作者') },
  { toPath: '时间/出版年份', basis: '时间/出版年份 下的四位年份', match: yearUnderTime },
  { toPath: '状态', basis: '来自路径 状态/*', match: under('状态') },
];

/** 路径末段(`/` 为分隔符) */
export function leaf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** 命中的全部建议(一个标签最多一条),按标签路径排序 */
export function suggestRelations(tags: readonly TagCount[]): RelationSuggestion[] {
  const byPath = new Map(tags.map((t) => [t.path, t]));
  const out: RelationSuggestion[] = [];
  for (const tag of tags) {
    const parts = tag.path.split('/');
    for (const rule of SUGGESTION_RULES) {
      if (!rule.match(parts)) continue;
      const target = byPath.get(rule.toPath);
      if (!target) continue; // 目标标签不存在:不猜 id,静默跳过
      out.push({
        tagId: tag.id,
        tagPath: tag.path,
        toTagId: target.id,
        toName: leaf(rule.toPath),
        basis: rule.basis,
      });
      break; // 一个标签只给一条建议
    }
  }
  // 按码位排序(不用 localeCompare:拼音序随环境变化,会让读数不稳)
  return out.sort((a, b) => (a.tagPath < b.tagPath ? -1 : a.tagPath > b.tagPath ? 1 : 0));
}

/** 行当前生效的目标:改过就取改后的,否则取建议的 */
export function effectiveTarget(row: RelationSuggestion, overrides: ReadonlyMap<number, number>): number {
  return overrides.get(row.tagId) ?? row.toTagId;
}

/** 待确认建议:丢掉已建立该关系(幂等,R5)与会话内忽略的行 */
export function pendingSuggestions(
  rows: readonly RelationSuggestion[],
  existing: ReadonlyMap<number, ReadonlySet<number>>,
  ignored: ReadonlySet<number>,
  overrides: ReadonlyMap<number, number>
): RelationSuggestion[] {
  return rows.filter(
    (r) => !ignored.has(r.tagId) && !existing.get(r.tagId)?.has(effectiveTarget(r, overrides))
  );
}

/** 批量勾选开关:只动给定行的排除集,筛选外的原样保留(全选/全不选只看可见项) */
export function setExcludedFor(
  prev: ReadonlySet<number>,
  ids: readonly number[],
  on: boolean
): Set<number> {
  const next = new Set(prev);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

export interface WritePlan {
  /** 每个选中标签要建立的一条关系(增量写,不碰该标签已有的别的边) */
  writes: { fromId: number; toId: number }[];
}

/** 把「选中的行 + 改过的目标」算成写库计划(纯函数,不碰 API)。
 *  一条建议 = 一条边;`set_tag_relation` 幂等,不会覆盖该标签的其它关系。 */
export function planWrites(
  rows: readonly RelationSuggestion[],
  selected: ReadonlySet<number>,
  overrides: ReadonlyMap<number, number>
): WritePlan {
  const writes: WritePlan['writes'] = [];
  for (const row of rows) {
    if (!selected.has(row.tagId)) continue;
    writes.push({ fromId: row.tagId, toId: effectiveTarget(row, overrides) });
  }
  return { writes };
}
