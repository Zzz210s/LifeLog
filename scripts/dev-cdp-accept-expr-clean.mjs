// 表达式验收(dev-cdp-accept-expr.mjs)的数据安全件:基线洁净审计、运行清单、
// `filter_current` 合法性/还原口径、清收(只删 验收6 命名空间)。
// 原则:只准动脚本自建的数据;任何可疑情况(基线有 AI 残留 / 待删根与基线撞车 /
// filter_current 原值失效)一律记 FAIL 并保守处理,绝不静默删用户数据。
// 注:保存视图与 `filter_last` 已随迁移 014 删除;多页筛选快照随迁移 016 迁成单份 `filter_current`,
// 故审计/还原的对象换成 `filter_current` 原文,视图相关清收一并移除。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { conditions, sleep } from './cdp-lib.mjs';
/** 验收产物目录(基线 / 运行清单,均在 .superpowers/ 下、不入库) */
export const OUT = '.superpowers/expr6';
/** 自建标签统一命名空间:cleanup 只删这棵子树 */
export const RUN_ROOT = '验收6';
export const MARK = '验收六';
/** 条件的归一化键(与前端 EMPTY_FILTER 同键序;日期键 from/to 已随 D2 删除) */
const EMPTY_CONDITIONS = { keyword: null, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null };
/** 默认条件文本(与前端 EMPTY_FILTER 同形):filter_current 的还原兜底值 */
export const EMPTY_FILTER = JSON.stringify(EMPTY_CONDITIONS);

/** 笔记首行 / 标签路径里的 AI 残留标记 */
const RESIDUE_TEXT = /验收|CDP|表达式测试/;
/** 标签路径的 AI 残留前缀(自建命名空间 + 前几轮脚本用过的根级标签名) */
const RESIDUE_TAG = /^(验收6|验收六|表达式测试|临时)(\/|$)/;

const firstLine = (idLine) => idLine.slice(idLine.indexOf('|') + 1);

/** 单个条件对象 → 归一化 JSON(键序固定,filter_current 逐键对照才可比) */
const canonConditions = (o) => JSON.stringify({
  ...EMPTY_CONDITIONS,
  ...(o && typeof o === 'object' ? o : {}),
});

/**
 * `filter_current` 原文 → 归一化 JSON(缺失/空白 = 默认空条件;非法 = INVALID 前缀便于报错)。
 * 只保留已知条件字段,未知字段不参与比较。
 */
export function canonFilter(raw) {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (s === '') return EMPTY_FILTER;
  let o;
  try {
    o = JSON.parse(s);
  } catch {
    return 'INVALID:' + s;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'INVALID:' + s;
  return canonConditions(o);
}

/** `filter_current` 引用的标签路径:`tags`/`excludeTags` 的 path + 表达式里的 #路径 */
export function refsOfFilter(raw) {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (s === '') return { refs: [], parseable: true };
  let c;
  try {
    c = JSON.parse(s);
  } catch {
    return { refs: [], parseable: false };
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { refs: [], parseable: false };
  const refs = [];
  for (const key of ['tags', 'excludeTags']) {
    for (const t of Array.isArray(c[key]) ? c[key] : []) {
      if (t && typeof t.path === 'string') refs.push(t.path);
    }
  }
  for (const m of String(c.expr ?? '').matchAll(/#=?([^\s()]+)/g)) refs.push(m[1]);
  return { refs: [...new Set(refs)], parseable: true };
}

/** 基线洁净审计:返回问题清单(空数组 = 基线干净,可当基线) */
export function auditBaseline(inv) {
  const problems = [];
  for (const line of inv.ids) {
    if (RESIDUE_TEXT.test(firstLine(line))) problems.push(`笔记 ${line} 首行含 AI 标记`);
  }
  for (const p of inv.paths) {
    if (RESIDUE_TAG.test(p)) problems.push(`标签路径疑似 AI 残留: ${p}`);
  }
  const { refs, parseable } = refsOfFilter(inv.filterCurrent);
  if (!parseable) problems.push(`filter_current 非法 JSON: ${inv.filterCurrent}`);
  for (const r of refs) {
    if (!inv.paths.includes(r)) problems.push(`filter_current 引用了不存在的路径: ${r}`);
  }
  return problems;
}

/** 交集(按集合语义比较两个 id / 路径数组) */
const overlap = (a, b) => b.filter((x) => a.includes(x));

/** 读回运行清单(main 阶段写入,cleanup 阶段用来证明"删净自己的数据") */
export const readManifest = () => JSON.parse(readFileSync(join(OUT, 'run-manifest.json'), 'utf8'));
export const readBaseline = () => JSON.parse(readFileSync(join(OUT, 'inventory-before.json'), 'utf8'));

/**
 * 清收:删净运行清单里的笔记 + 验收6 标签子树,按合法性还原 `filter_current`,
 * 并用运行清单断言(交集为空)+ filter_current 等价 + 清收后无残留 三条读数收尾。
 */
export async function cleanupRun({ call, listTags, inventory, x, record, j }) {
  const man = readManifest();
  const base = readBaseline();
  const chips = await x('chips()');
  if (Array.isArray(chips) && chips.some((c) => c.label.startsWith('表达式:'))) {
    await x("clickChipButton('移除条件')");
    await sleep(900);
  }
  for (const id of man.noteIds) await call('delete_note', { id });
  // 兜底:清单之外任何正文含标记的笔记(理论为空);删掉并记入明细,交由残留读数判定
  const swept = (await call('query_notes', { conditions: conditions({ keyword: MARK }), offset: 0 })).map((n) => n.id);
  for (const id of swept) await call('delete_note', { id });
  // 标签:只删 验收6 子树;该根若已在基线里 = 会误伤用户数据 -> 跳过并 FAIL
  const clash = base.paths.filter((p) => p === RUN_ROOT || p.startsWith(RUN_ROOT + '/'));
  if (clash.length > 0) {
    record('清收:待删根 验收6 出现在基线里,跳过删除(避免误伤用户数据)', false, j({ clash }));
  } else {
    const mine = (await listTags()).map((t) => t.path)
      .filter((p) => p === RUN_ROOT || p.startsWith(RUN_ROOT + '/'))
      .sort((a, b) => b.length - a.length); // 深的先删(删根即级联子树,兜底防孤儿)
    for (const p of mine) {
      const t = (await listTags()).find((t) => t.path === p);
      if (t) await call('delete_tag', { tagId: t.id });
    }
  }
  // filter_current:原值合法(可解析且引用路径都还在)才装回;失效/残留则写默认空条件
  const mid = await inventory();
  const { refs, parseable } = refsOfFilter(man.filterBefore);
  const missing = refs.filter((r) => !mid.paths.includes(r));
  const origRaw = man.filterBefore === null || man.filterBefore === undefined ? '' : String(man.filterBefore);
  const origOk = parseable && missing.length === 0 && !RESIDUE_TEXT.test(origRaw);
  await call('set_setting', { key: 'filter_current', value: origOk && origRaw !== '' ? origRaw : EMPTY_FILTER });
  await sleep(1200);
  const after = await inventory();
  const o = {
    notes: overlap(man.noteIds, after.ids.map((l) => Number(l.split('|')[0]))),
    tags: overlap(man.tagPaths, after.paths),
    swept,
  };
  record('清收1:运行清单断言(清单里的笔记 / 标签全部删净)',
    o.notes.length === 0 && o.tags.length === 0 && swept.length === 0, j(o));
  record('清收2:filter_current 还原口径(原值合法则逐键等价装回,否则写默认空条件)',
    origOk ? canonFilter(after.filterCurrent) === canonFilter(man.filterBefore) : canonFilter(after.filterCurrent) === EMPTY_FILTER,
    j({ origRaw, origOk, missing, after: after.filterCurrent, before: man.filterBefore }));
  const problems = auditBaseline(after);
  record('清收3:清收后库存洁净(无 AI 残留,可当下一轮基线)', problems.length === 0,
    j({ problems, notes: after.notes, tagPaths: after.paths.length, filterCurrent: after.filterCurrent }));
  return after;
}
