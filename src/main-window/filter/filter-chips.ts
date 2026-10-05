/**
 * 条件对象 -> 可单删 chip 与中文摘要的纯函数(spec 6.2):
 * 每个收窄来源一个 chip,chip 自带「删掉我之后的完整条件对象」;
 * 摘要为中文一句话,空条件返回空串。
 * 标签路径都是**字符串位**(chip label / 中文摘要),故一律走 tagLabelPlain 的显示口径。
 */
import { hasExpr } from '../../shared/filter-conditions';
import type { FilterConditions, TagCond } from '../../shared/filter-conditions';
import { tagLabelPlain } from '../../shared/tag-label';
import { CARRY_MARK, exprSegments, showCarry, truncateExpr } from './expr-tag-spans';
import type { CarryPaths, SummarySegment } from './expr-tag-spans';

// 截断与表达式片段(含标签叶子定位)的真源在 expr-tag-spans.ts,这里转发给既有调用点
export { EXPR_TEXT_MAX, truncateExpr } from './expr-tag-spans';
export type { CarryPaths, SummarySegment } from './expr-tag-spans';

/** chip 种类与文案一一对应;remove 是删掉该 chip 后的条件对象(完整替换用) */
export type Chip = {
  kind: 'keyword' | 'tag' | 'excludeTag' | 'presence' | 'sort' | 'expr';
  label: string;
  /** 悬浮提示(标签 chip 用它区分含子级/仅本级;表达式 chip 放未截断原文) */
  title?: string;
  remove: FilterConditions;
};

/** 含子级 chip 的前缀标记(仅本级不加标记,靠 title 说明) */
const CHILD_MARK = '⊢ ';

/** chip 上的标签文案:'⊢ #工作'(含子级)/ '#工作'(仅本级);显示口径 = tagLabelPlain(去掉行内 md 语法) */
const chipTag = (t: TagCond): string =>
  `${t.includeChildren ? CHILD_MARK : ''}#${tagLabelPlain(t.path)}`;

/** 标签 chip 的悬浮提示:含子级 / 仅本级 */
const tagTitle = (t: TagCond): string => (t.includeChildren ? '含子级' : '仅本级');

/** 表达式 chip / 摘要的文案:「表达式:<原文>」 */
const exprLabel = (text: string, truncate: boolean): string =>
  `表达式:${truncate ? truncateExpr(text) : text}`;

/** 排序 chip 文案(仅非默认时出现) */
export const SORT_CHIP_LABEL = '最早在前';

/** 每个收窄来源一个 chip;排序仅在非默认(最早在前)时出现 */
export function chipsOf(c: FilterConditions): Chip[] {
  const chips: Chip[] = [];
  const kw = (c.keyword ?? '').trim();
  if (kw !== '') chips.push({ kind: 'keyword', label: `关键词:${kw}`, remove: { ...c, keyword: null } });
  c.tags.forEach((t) =>
    chips.push({
      kind: 'tag',
      label: chipTag(t),
      title: tagTitle(t),
      remove: { ...c, tags: c.tags.filter((x) => x !== t) },
    })
  );
  c.excludeTags.forEach((t) =>
    chips.push({
      kind: 'excludeTag',
      label: `排除 ${chipTag(t)}`,
      title: tagTitle(t),
      remove: { ...c, excludeTags: c.excludeTags.filter((x) => x !== t) },
    })
  );
  if (c.tagPresence !== null) {
    chips.push({
      kind: 'presence',
      label: c.tagPresence === 'none' ? '无标签' : '有标签',
      remove: { ...c, tagPresence: null },
    });
  }
  if (hasExpr(c)) {
    // 可单独删除(=置 null);点 label 可再次编辑(是否可点由 FilterChips 决定)
    chips.push({
      kind: 'expr',
      label: exprLabel(c.expr ?? '', true),
      title: exprLabel(c.expr ?? '', false),
      remove: { ...c, expr: null },
    });
  }
  if (c.sort === 'oldest') {
    chips.push({ kind: 'sort', label: SORT_CHIP_LABEL, remove: { ...c, sort: 'newest' } });
  }
  return chips;
}

/** 中文一句话摘要:'关键词「电影」;标签 工作+携带;无标签;最早在前';空条件为空串(含子级不进摘要) */
export function summaryOf(c: FilterConditions, carryPaths: CarryPaths = null): string {
  return plainOf(summarySegmentsOf(c, true, carryPaths));
}

/** 摘要的悬浮提示文本:与 summaryOf 同构,但表达式原文不截断(供 FilterBar 的 title) */
export function summaryTitleOf(c: FilterConditions, carryPaths: CarryPaths = null): string {
  return plainOf(summarySegmentsOf(c, false, carryPaths));
}

/** 片段拼回纯文本(摘要与 title 共用;片段自身已含 `;` 分隔) */
function plainOf(segs: SummarySegment[]): string {
  return segs.map((s) => s.text).join('');
}

/**
 * 摘要片段(结构化):普通文本与 `+携带` 小字分开,渲染侧按 carry 分样式。
 * 标签组里 `+携带` 紧随每个标签路径(引入与排除两侧都标);表达式里的标签叶子同样标。
 * `carryPaths` 给定「有携带者的标签路径集合」时,只有真有携带者的标签才标;
 * 传 null(数据未就绪)则退回都标。
 */
export function summarySegmentsOf(
  c: FilterConditions,
  truncate = true,
  carryPaths: CarryPaths = null
): SummarySegment[] {
  const groups: SummarySegment[][] = [];
  const kw = (c.keyword ?? '').trim();
  if (kw !== '') groups.push([{ text: `关键词「${kw}」`, carry: false }]);
  if (c.tags.length > 0) groups.push(tagGroup('标签 ', c.tags, carryPaths));
  if (c.excludeTags.length > 0) groups.push(tagGroup('排除 ', c.excludeTags, carryPaths));
  if (hasExpr(c)) groups.push(exprSegments(c.expr ?? '', truncate, carryPaths));
  if (c.tagPresence !== null) {
    groups.push([{ text: c.tagPresence === 'none' ? '无标签' : '有标签', carry: false }]);
  }
  if (c.sort === 'oldest') groups.push([{ text: SORT_CHIP_LABEL, carry: false }]);
  const out: SummarySegment[] = [];
  groups.forEach((g, i) => {
    if (i > 0) out.push({ text: ';', carry: false });
    out.push(...g);
  });
  return out;
}

/** 一个标签组:'标签 a+携带、b'(`+携带` 每项按是否有携带者跟) */
function tagGroup(prefix: string, list: TagCond[], carryPaths: CarryPaths): SummarySegment[] {
  const segs: SummarySegment[] = [{ text: prefix, carry: false }];
  list.forEach((t, i) => {
    if (i > 0) segs.push({ text: '、', carry: false });
    segs.push({ text: tagLabelPlain(t.path), carry: false });
    if (showCarry(t.path, carryPaths)) segs.push({ text: CARRY_MARK, carry: true });
  });
  return segs;
}

/**
 * 标签选择器落笔:exclude=false 进 tags、true 进 excludeTags;
 * 同一路径已存在(不论含子级开关)则原样返回,不重复添加。
 */
export function applyTagPick(
  c: FilterConditions,
  path: string,
  opts: { exclude: boolean; includeChildren: boolean }
): FilterConditions {
  if (opts.exclude) {
    if (c.excludeTags.some((t) => t.path === path)) return c;
    return { ...c, excludeTags: [...c.excludeTags, { path, includeChildren: opts.includeChildren }] };
  }
  if (c.tags.some((t) => t.path === path)) return c;
  return { ...c, tags: [...c.tags, { path, includeChildren: opts.includeChildren }] };
}
