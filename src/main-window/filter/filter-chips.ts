/**
 * 条件对象 -> 可单删 chip 的纯函数(spec 6.2;条件组化 2026-10-06 §5.5):
 * 每个收窄来源一个 chip,chip 自带「删掉我之后的完整条件对象」与所属组下标。
 * 中文摘要已拆到 `filter-summary.ts`(本模块照旧出口,调用点不用改)。
 * 标签路径都是**字符串位**(chip label),故一律走 tagLabelPlain 的显示口径。
 */
import { normalizeGroups, removeGroupItem, uiGroups } from '../../shared/filter-conditions';
import type { FilterConditions, GroupItem } from '../../shared/filter-conditions';
import type { ConditionHits } from '../../shared/tag-facts-types';
import { tagLabelPlain } from '../../shared/tag-label';
import { truncateExpr } from './expr-tag-spans';
import { sortChipLabel } from './sort-conditions';

// 表达式截断与片段类型的真源在 expr-tag-spans.ts;摘要真源在 filter-summary.ts —— 这里转发
export { EXPR_TEXT_MAX, truncateExpr } from './expr-tag-spans';
export type { CarryPaths, SummarySegment } from './expr-tag-spans';
export { summaryOf, summarySegmentsOf, summaryTitleOf } from './filter-summary';
// 标签/关系选择落笔抽到 filter-pick.ts(守 200 行上限),从本模块照旧出口
export { applyRelationPick, applyTagPick } from './filter-pick';

/** chip 种类与文案一一对应;remove 是删掉该 chip 后的条件对象(完整替换用) */
export type Chip = {
  kind: 'keyword' | 'tag' | 'excludeTag' | 'relation' | 'excludeRelation' | 'presence' | 'sort' | 'expr';
  label: string;
  /** 悬浮提示(标签 chip 用它区分含子级/仅本级;表达式 chip 放未截断原文) */
  title?: string;
  /** 标签 / 关系条件的独立命中数(条件栏小字「命中 N 条」;OR 组与其它 chip 无) */
  hits?: number;
  /** chip 所属条件组下标(排序 chip 无);组头渲染与按 (组, 项) 移除用 */
  groupIndex?: number;
  remove: FilterConditions;
};

/** 含子级 chip 的前缀标记(仅本级不加标记,靠 title 说明) */
const CHILD_MARK = '⊢ ';

type TagLike = { path: string; includeChildren: boolean };

/** chip 上的标签文案:'⊢ #工作'(含子级)/ '#工作'(仅本级);显示口径 = tagLabelPlain */
const chipTag = (t: TagLike): string =>
  `${t.includeChildren ? CHILD_MARK : ''}#${tagLabelPlain(t.path)}`;

/** 标签 chip 的悬浮提示:含子级 / 仅本级 */
const tagTitle = (t: TagLike): string => (t.includeChildren ? '含子级' : '仅本级');

/** 表达式 chip 的文案:「表达式:<原文>」 */
const exprLabel = (text: string, truncate: boolean): string =>
  `表达式:${truncate ? truncateExpr(text) : text}`;

/** 关系 chip 文案:`关系:国籍`(与 `标签` 的 `#中国` 视觉区分) */
const chipRelation = (r: { path: string }): string => `关系:${tagLabelPlain(r.path)}`;

/** 每个收窄来源一个 chip(按组序、组内项序);`hits.groups` 给定(后端 `condition_hit_counts`)
 *  时,AND 组逐项贴独立命中数,OR 组不贴(chip 上无读数,组头给组命中数) */
export function chipsOf(c: FilterConditions, hits: ConditionHits | null = null): Chip[] {
  const n = normalizeGroups(c);
  const chips: Chip[] = [];
  // 界面可能含空组(刚新建、还没加条件):后端读数按**非空组**给出,故用 hitIdx 单独计数
  let hitIdx = -1;
  uiGroups(c).forEach((g, gi) => {
    if (g.items.length === 0) return;
    hitIdx += 1;
    const gh = hits?.groups?.[hitIdx];
    const perItem = gh !== undefined && gh.op === 'and' ? gh.itemHits : null;
    g.items.forEach((it, ii) => {
      const remove = removeGroupItem(c, gi, ii);
      const hit = perItem !== null ? perItem[ii] : undefined;
      const base = { groupIndex: gi, remove };
      if (it.kind === 'keyword') {
        chips.push({ ...base, kind: 'keyword', label: `关键词:${it.value.trim()}` });
      } else if (it.kind === 'tag') {
        chips.push({ ...base, kind: 'tag', label: chipTag(it), title: tagTitle(it), hits: hit });
      } else if (it.kind === 'excludeTag') {
        chips.push({ ...base, kind: 'excludeTag', label: `排除 ${chipTag(it)}`, title: tagTitle(it), hits: hit });
      } else if (it.kind === 'relation') {
        chips.push({
          ...base, kind: 'relation', label: chipRelation(it),
          title: '关系条件(指向该标签的标签子树,并叠加继承)', hits: hit,
        });
      } else if (it.kind === 'excludeRelation') {
        chips.push({
          ...base, kind: 'excludeRelation', label: `排除 ${chipRelation(it)}`,
          title: '排除关系条件(与包含侧同一份命中集)', hits: hit,
        });
      } else if (it.kind === 'presence') {
        chips.push({ ...base, kind: 'presence', label: it.value === 'none' ? '无标签' : '有标签' });
      } else {
        chips.push({
          ...base, kind: 'expr', label: exprLabel(it.value, true), title: exprLabel(it.value, false),
        });
      }
    });
  });
  // 每条启用排序一个 chip(停用的不出);单删 = 从数组移除该项。排序不属于任何条件组
  n.sorts.forEach((s) => {
    if (!s.enabled) return;
    chips.push({
      kind: 'sort',
      label: sortChipLabel(s),
      remove: { ...n, sorts: n.sorts.filter((x) => x !== s) },
    });
  });
  return chips;
}

/** 组内项类型的再出口(调用点只从本模块取 chip 相关类型) */
export type { GroupItem };
