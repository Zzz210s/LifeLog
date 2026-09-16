/**
 * 条件对象 -> 可单删 chip 与中文摘要的纯函数(spec 6.2):
 * 每个收窄来源一个 chip,chip 自带「删掉我之后的完整条件对象」;
 * 摘要为中文一句话,空条件返回空串。
 */
import { hasExpr } from '../shared/filter-conditions';
import type { FilterConditions, TagCond } from '../shared/filter-conditions';

/** chip 种类与文案一一对应;remove 是删掉该 chip 后的条件对象(完整替换用) */
export type Chip = {
  kind: 'keyword' | 'tag' | 'excludeTag' | 'date' | 'presence' | 'sort' | 'expr';
  label: string;
  /** 悬浮提示(标签 chip 用它区分含子级/仅本级;表达式 chip 放未截断原文) */
  title?: string;
  remove: FilterConditions;
};

/** 含子级 chip 的前缀标记(仅本级不加标记,靠 title 说明) */
const CHILD_MARK = '⊢ ';

/** chip 上的标签文案:'⊢ #工作'(含子级)/ '#工作'(仅本级) */
const chipTag = (t: TagCond): string => `${t.includeChildren ? CHILD_MARK : ''}#${t.path}`;

/** 标签 chip 的悬浮提示:含子级 / 仅本级 */
const tagTitle = (t: TagCond): string => (t.includeChildren ? '含子级' : '仅本级');

/** 日期短格式:'2026-08-01' -> '08-01'(ISO 保证定宽,直接切片) */
const shortDate = (iso: string): string => iso.slice(5);

/** 日期 chip 文案:'08-01 起' / '截至 09-13' / '08-01 至 09-13' */
export function dateChipLabel(from: string | null, to: string | null): string {
  if (from !== null && to !== null) return `${shortDate(from)} 至 ${shortDate(to)}`;
  if (from !== null) return `${shortDate(from)} 起`;
  return `截至 ${shortDate(to ?? '')}`;
}

/** 表达式 chip / 摘要里原文的截断长度(超出补省略号;全文放 title) */
export const EXPR_TEXT_MAX = 40;

/** 按字符(码点)截断表达式原文:不超长原样返回,超长截到 EXPR_TEXT_MAX 并补「…」 */
export function truncateExpr(text: string, max = EXPR_TEXT_MAX): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join('') + '…';
}

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
  if (c.from !== null || c.to !== null) {
    chips.push({ kind: 'date', label: dateChipLabel(c.from, c.to), remove: { ...c, from: null, to: null } });
  }
  if (c.tagPresence !== null) {
    chips.push({
      kind: 'presence',
      label: c.tagPresence === 'none' ? '无自定义标签' : '有标签',
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

/** 中文一句话摘要:'关键词「电影」;标签 工作;无自定义标签;最早在前';空条件为空串(含子级不进摘要) */
export function summaryOf(c: FilterConditions): string {
  return summaryParts(c, true).join(';');
}

/** 摘要的悬浮提示文本:与 summaryOf 同构,但表达式原文不截断(供 FilterBar 的 title) */
export function summaryTitleOf(c: FilterConditions): string {
  return summaryParts(c, false).join(';');
}

/** 摘要分组(truncate 控制表达式原文是否截断) */
function summaryParts(c: FilterConditions, truncate: boolean): string[] {
  const parts: string[] = [];
  const kw = (c.keyword ?? '').trim();
  if (kw !== '') parts.push(`关键词「${kw}」`);
  if (c.tags.length > 0) parts.push(`标签 ${c.tags.map((t) => t.path).join('、')}`);
  if (c.excludeTags.length > 0) parts.push(`排除 ${c.excludeTags.map((t) => t.path).join('、')}`);
  if (hasExpr(c)) parts.push(exprLabel(c.expr ?? '', truncate));
  if (c.from !== null || c.to !== null) parts.push(`日期 ${dateChipLabel(c.from, c.to)}`);
  if (c.tagPresence !== null) parts.push(c.tagPresence === 'none' ? '无自定义标签' : '有标签');
  if (c.sort === 'oldest') parts.push(SORT_CHIP_LABEL);
  return parts;
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
