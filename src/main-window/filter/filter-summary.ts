/**
 * 条件对象 -> 中文摘要(自 `filter-chips.ts` 拆出,守 200 行)。
 * 单个全 AND 组时与旧口径逐字一致;多组 / OR 组时每组加括号、组内与组间分别用 `且` / `或`。
 * 标签路径是**字符串位**,一律走 tagLabelPlain 的显示口径。
 */
import { normalizeGroups } from '../../shared/filter-conditions';
import type { FilterConditions, GroupItem } from '../../shared/filter-conditions';
import { tagLabelPlain } from '../../shared/tag-label';
import { CARRY_MARK, exprSegments, showCarry } from './expr-tag-spans';
import type { CarryPaths, SummarySegment } from './expr-tag-spans';

/** 中文一句话摘要;空条件为空串(含子级不进摘要) */
export function summaryOf(c: FilterConditions, carryPaths: CarryPaths = null): string {
  return plainOf(summarySegmentsOf(c, true, carryPaths));
}

/** 摘要的悬浮提示文本:与 summaryOf 同构,但表达式原文不截断(供筛选栏 title) */
export function summaryTitleOf(c: FilterConditions, carryPaths: CarryPaths = null): string {
  return plainOf(summarySegmentsOf(c, false, carryPaths));
}

/** 片段拼回纯文本(摘要与 title 共用;片段自身已含分隔符) */
function plainOf(segs: SummarySegment[]): string {
  return segs.map((s) => s.text).join('');
}

/** 一个可合并的渲染段:连续同类项合成一段(单 AND 组的摘要文案与旧口径逐字一致) */
interface Run {
  cat: GroupItem['kind'];
  items: GroupItem[];
}

/** 连续同类项归段(标签、排除标签、关系各成一段,段内以 `、` 连接) */
function runsOf(items: GroupItem[]): Run[] {
  const runs: Run[] = [];
  for (const it of items) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.cat === it.kind) last.items.push(it);
    else runs.push({ cat: it.kind, items: [it] });
  }
  return runs;
}

/**
 * 摘要片段(结构化):普通文本与 `+携带` 小字分开,渲染侧按 carry 分样式。
 * 单个全 AND 组时与旧口径逐字一致(`关键词「x」;标签 a、b;排除 c;表达式:…`);
 * 多组 / OR 组时每组加括号、组内与组间分别用 `且` / `或`。
 */
export function summarySegmentsOf(
  c: FilterConditions,
  truncate = true,
  carryPaths: CarryPaths = null
): SummarySegment[] {
  const n = normalizeGroups(c);
  const out: SummarySegment[] = [];
  const push = (text: string) => out.push({ text, carry: false });
  const wrap = n.groups.length > 1;
  n.groups.forEach((g, gi) => {
    if (gi > 0) push(n.groupOp === 'or' ? ' 或 ' : ' 且 ');
    if (wrap) push('(');
    runsOf(g.items).forEach((run, ri) => {
      if (ri > 0) push(g.op === 'or' ? ' 或 ' : ';');
      out.push(...runSegments(run, truncate, carryPaths));
    });
    if (wrap) push(')');
  });
  const enabledSorts = n.sorts.filter((s) => s.enabled).length;
  if (enabledSorts > 0) {
    if (out.length > 0) push(';');
    push(`${enabledSorts} 条排序`);
  }
  return out;
}

/** 一段(连续同类项)的片段:前缀 + 项文案(`+携带` 小字按 carryPaths 判) */
function runSegments(run: Run, truncate: boolean, carryPaths: CarryPaths): SummarySegment[] {
  const first = run.items[0];
  if (first.kind === 'keyword') {
    return [{ text: `关键词「${first.value.trim()}」`, carry: false }];
  }
  if (first.kind === 'expr') {
    return exprSegments(first.value, truncate, carryPaths);
  }
  if (first.kind === 'presence') {
    return run.items.map((it) => ({
      text: it.kind === 'presence' && it.value === 'none' ? '无标签' : '有标签',
      carry: false,
    }));
  }
  if (first.kind === 'tag' || first.kind === 'excludeTag') {
    const prefix = first.kind === 'tag' ? '标签 ' : '排除 ';
    return tagGroup(prefix, run.items as Array<{ path: string; includeChildren: boolean }>, carryPaths);
  }
  const prefix = first.kind === 'relation' ? '关系:' : '排除 关系:';
  return relationGroup(prefix, run.items as Array<{ path: string }>);
}

/** 一个标签段:'标签 a+携带、b'(`+携带` 每项按是否有携带者跟) */
function tagGroup(
  prefix: string,
  list: Array<{ path: string; includeChildren: boolean }>,
  carryPaths: CarryPaths
): SummarySegment[] {
  const segs: SummarySegment[] = [{ text: prefix, carry: false }];
  list.forEach((t, i) => {
    if (i > 0) segs.push({ text: '、', carry: false });
    segs.push({ text: tagLabelPlain(t.path), carry: false });
    if (showCarry(t.path, carryPaths)) segs.push({ text: CARRY_MARK, carry: true });
  });
  return segs;
}

/** 一个关系段:`关系:国籍、所在`(关系没有携带标记,携带是标签条件的事) */
function relationGroup(prefix: string, list: Array<{ path: string }>): SummarySegment[] {
  const segs: SummarySegment[] = [{ text: prefix, carry: false }];
  list.forEach((r, i) => {
    if (i > 0) segs.push({ text: '、', carry: false });
    segs.push({ text: tagLabelPlain(r.path), carry: false });
  });
  return segs;
}
