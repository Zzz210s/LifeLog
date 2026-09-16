// 视图图标验收(scripts/dev-cdp-accept-icon.mjs)的数据安全件:基线洁净审计、运行清单、
// filter_last 合法性/还原口径、清收(只删清单里的视图 + 「图标验收」命名空间)、迁移列只读探测。
// 原则:只准动脚本自建的数据;任何可疑情况(基线有 AI 残留 / 待删命名空间与基线撞车 /
// filter_last 原值失效)一律记 FAIL 并保守处理,绝不静默删用户数据。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sleep } from './cdp-lib.mjs';

/** 验收产物目录(基线 / 运行清单,均在 .superpowers/ 下、不入库) */
export const OUT = '.superpowers/icon7';
/** 自建视图命名空间:标题统一带该前缀,清收只认它 */
export const RUN_TAG = '图标验收';
export const V1 = RUN_TAG + '视图甲';
export const V2 = RUN_TAG + '视图乙';
export const V3 = RUN_TAG + '视图丙';
/** 真实库(与工程约定一致);只读探测 + 脏名字直写用 */
export const DB_PATH = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
/** 默认条件的归一化文本:与前端 EMPTY_FILTER 同键序,也是 filter_last 的还原兜底值 */
export const EMPTY_FILTER = JSON.stringify({
  keyword: null, tags: [], excludeTags: [], from: null, to: null,
  tagPresence: null, sort: 'newest', expr: null,
});

/** 视图标题 / 笔记首行里的 AI 残留标记 */
const RESIDUE_TEXT = /验收|CDP|图标测试/;
/** 标签路径的 AI 残留前缀(自建命名空间 + 前几轮脚本用过的根级标签名) */
const RESIDUE_TAG = /^(验收|图标验收|表达式测试|临时|P5回归)(\/|$)/;

const firstLine = (idLine) => idLine.slice(idLine.indexOf('|') + 1);

/** filter_last 原文 -> 归一化 JSON(缺失/空白 = 默认条件;非法 = INVALID 前缀便于报错) */
export function canonFilter(raw) {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (s === '') return EMPTY_FILTER;
  let o;
  try {
    o = JSON.parse(s);
  } catch {
    return 'INVALID:' + s;
  }
  return JSON.stringify({
    keyword: o.keyword ?? null, tags: o.tags ?? [], excludeTags: o.excludeTags ?? [],
    from: o.from ?? null, to: o.to ?? null, tagPresence: o.tagPresence ?? null,
    sort: o.sort ?? 'newest', expr: o.expr ?? null,
  });
}

/** filter_last 引用的标签路径:tags/excludeTags 的 path + 表达式里的 #路径 */
export function refsOfFilter(raw) {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (s === '') return { refs: [], parseable: true };
  let o;
  try {
    o = JSON.parse(s);
  } catch {
    return { refs: [], parseable: false };
  }
  const refs = [];
  for (const key of ['tags', 'excludeTags']) {
    for (const t of Array.isArray(o[key]) ? o[key] : []) {
      if (t && typeof t.path === 'string') refs.push(t.path);
    }
  }
  for (const m of String(o.expr ?? '').matchAll(/#=?([^\s()]+)/g)) refs.push(m[1]);
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
  for (const t of inv.viewTitles) {
    if (RESIDUE_TEXT.test(t)) problems.push(`视图标题疑似 AI 残留: ${t}`);
  }
  const { refs, parseable } = refsOfFilter(inv.filterLast);
  if (!parseable) problems.push(`filter_last 非法 JSON: ${inv.filterLast}`);
  for (const r of refs) {
    if (!inv.paths.includes(r)) problems.push(`filter_last 引用了不存在的路径: ${r}`);
  }
  return problems;
}

/** 只读探测真实库:user_version 与 saved_views.icon 列(notnull 标志) */
export function dbProbe() {
  const db = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    const cols = db.prepare('PRAGMA table_info(saved_views)').all();
    const icon = cols.find((c) => c.name === 'icon');
    return { version, icon: icon ? { notnull: icon.notnull } : null, columns: cols.map((c) => c.name) };
  } finally {
    db.close();
  }
}

/** 脏名字场景:绕过命令层直接写库(模拟手工改库/旧数据),返回读回的 icon 值 */
export function setIconDirect(id, icon) {
  const db = new DatabaseSync(DB_PATH);
  try {
    db.exec('PRAGMA busy_timeout = 3000');
    db.prepare('UPDATE saved_views SET icon = ? WHERE id = ?').run(icon, id);
  } finally {
    db.close();
  }
  const ro = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
  try {
    const row = ro.prepare('SELECT icon FROM saved_views WHERE id = ?').get(id);
    return row ? row.icon : null;
  } finally {
    ro.close();
  }
}

/** 读回运行清单(main 阶段写入)/基线快照 */
export const readManifest = () => JSON.parse(readFileSync(join(OUT, 'run-manifest.json'), 'utf8'));
export const readBaseline = () => JSON.parse(readFileSync(join(OUT, 'inventory-before.json'), 'utf8'));
export const writeJson = (name, value) => writeFileSync(join(OUT, name), JSON.stringify(value, null, 2));

/** 交集(按集合语义比较两个 id / 标题数组) */
const overlap = (a, b) => b.filter((x) => a.includes(x));

/**
 * 清收:删净运行清单里的视图 + 命名空间兜底扫地,按合法性还原 filter_last,
 * 并用运行清单断言(交集为空)+ filter_last 等价 + 清收后无残留 三条读数收尾。
 */
export async function cleanupRun({ call, listViews, inventory, record, j }) {
  const man = readManifest();
  const base = readBaseline();
  for (const id of man.viewIds) await call('delete_view', { id }).catch(() => {});
  // 兜底:清单之外的命名空间视图(理论为空);若基线里已有同名视图则跳过并 FAIL,避免误伤
  const clash = base.viewTitles.filter((t) => t.startsWith(RUN_TAG));
  if (clash.length > 0) {
    record('清收:「' + RUN_TAG + '」前缀视图已存在于基线,跳过兜底删除(避免误伤用户数据)', false, j({ clash }));
  } else {
    for (const v of (await listViews()).filter((v) => v.title.startsWith(RUN_TAG))) {
      await call('delete_view', { id: v.id }).catch(() => {});
    }
  }
  // filter_last:原值合法(可解析且引用路径都还在)才装回;失效/残留则写 EMPTY_FILTER
  const mid = await inventory();
  const { refs, parseable } = refsOfFilter(man.filterLastBefore);
  const missing = refs.filter((r) => !mid.paths.includes(r));
  const origRaw = man.filterLastBefore === null || man.filterLastBefore === undefined ? '' : String(man.filterLastBefore);
  const origOk = parseable && missing.length === 0 && !RESIDUE_TEXT.test(origRaw);
  await call('set_setting', { key: 'filter_last', value: origOk && origRaw !== '' ? origRaw : EMPTY_FILTER });
  await sleep(1200);
  const after = await inventory();
  const manIds = man.viewIds;
  const o = { views: overlap(manIds, after.viewIds) };
  record('清收1:运行清单断言(清单里的视图已全部删净)', o.views.length === 0, j(o));
  record('清收2:filter_last 还原口径(原值合法则逐键等价装回,否则写默认条件)',
    origOk ? canonFilter(after.filterLast) === canonFilter(man.filterLastBefore)
      : canonFilter(after.filterLast) === EMPTY_FILTER,
    j({ origRaw, origOk, missing, after: after.filterLast, before: man.filterLastBefore }));
  const problems = auditBaseline(after);
  record('清收3:清收后库存洁净(无 AI 残留,可当下一轮基线)', problems.length === 0, j({ problems, after }));
  record('清收4:自建视图归零(基线 ' + base.views + ' 个,清收后 ' + after.views + ' 个)',
    after.views === base.views, j({ before: base.views, after: after.views }));
  return after;
}
