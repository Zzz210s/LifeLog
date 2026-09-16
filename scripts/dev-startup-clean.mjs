// 冷启动/启动路径验收(scripts/dev-cdp-accept-startup.mjs)的数据安全件:
// 只读库存快照、基线洁净审计、运行清单、清收(删清单里的笔记与视图 + 还原 filter_last/theme)。
// 原则:只动脚本自建的数据;任何可疑情况(基线有 AI 残留 / 清单与基线撞车 / 原值失效)
// 一律记 FAIL 并保守处理,绝不静默删用户数据。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sleep } from './cdp-lib.mjs';

/** 验收产物目录(基线 / 运行清单,在 .superpowers/ 下、不入库) */
export const OUT = '.superpowers/startup4';
/** 自建数据命名空间:笔记正文前缀 + 视图标题前缀,清收只认它 */
export const RUN_TAG = '启动验收';
export const TEST_NOTE = RUN_TAG + '输入栏保存';
export const TEST_VIEW = RUN_TAG + '视图';
/** 真实库(工程约定路径) */
export const DB_PATH = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
/** 默认条件归一化文本(与前端 EMPTY_FILTER 同键序,也是 filter_last 的还原兜底值) */
export const EMPTY_FILTER = JSON.stringify({
  keyword: null, tags: [], excludeTags: [], from: null, to: null,
  tagPresence: null, sort: 'newest', expr: null,
});

const RESIDUE_TEXT = /验收|CDP|图标测试/;
const RESIDUE_TAG = /^(验收|图标验收|表达式测试|启动验收|临时|P5回归)(\/|$)/;
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

/** filter_last 引用的标签路径(tags/excludeTags 的 path + 表达式里的 #路径) */
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
    for (const t of Array.isArray(o[key]) ? o[key] : []) if (t && typeof t.path === 'string') refs.push(t.path);
  }
  for (const m of String(o.expr ?? '').matchAll(/#=?([^\s()]+)/g)) refs.push(m[1]);
  return { refs: [...new Set(refs)], parseable: true };
}

/** 只读库存快照:笔记数/id|首行、标签路径、视图数/id/标题、filter_last、theme(全部走 SQLite,不依赖窗口) */
export function dbInventory() {
  const db = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
  try {
    const notes = db.prepare('SELECT id, content FROM notes ORDER BY id').all();
    const tags = db.prepare('SELECT path FROM tags').all().map((t) => t.path).sort();
    const views = db.prepare('SELECT id, title FROM saved_views ORDER BY id').all();
    const get = (k) => {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
      return row ? row.value : null;
    };
    return {
      notes: notes.length,
      ids: notes.map((n) => n.id + '|' + String(n.content).split('\n')[0]).sort(),
      paths: tags,
      views: views.length,
      viewIds: views.map((v) => v.id).sort((a, b) => a - b),
      viewTitles: views.map((v) => v.title),
      filterLast: get('filter_last'),
      theme: get('theme'),
      version: db.prepare('PRAGMA user_version').get().user_version,
    };
  } finally {
    db.close();
  }
}

/** 基线洁净审计:返回问题清单(空 = 可当基线) */
export function auditBaseline(inv) {
  const problems = [];
  for (const line of inv.ids) if (RESIDUE_TEXT.test(firstLine(line))) problems.push(`笔记 ${line} 首行含 AI 标记`);
  for (const p of inv.paths) if (RESIDUE_TAG.test(p)) problems.push(`标签路径疑似 AI 残留: ${p}`);
  for (const t of inv.viewTitles) if (RESIDUE_TEXT.test(t)) problems.push(`视图标题疑似 AI 残留: ${t}`);
  const { refs, parseable } = refsOfFilter(inv.filterLast);
  if (!parseable) problems.push(`filter_last 非法 JSON: ${inv.filterLast}`);
  for (const r of refs) if (!inv.paths.includes(r)) problems.push(`filter_last 引用了不存在的路径: ${r}`);
  return problems;
}

export const readManifest = () => JSON.parse(readFileSync(join(OUT, 'run-manifest.json'), 'utf8'));
export const readBaseline = () => JSON.parse(readFileSync(join(OUT, 'inventory-before.json'), 'utf8'));
export const writeJson = (name, value) => writeFileSync(join(OUT, name), JSON.stringify(value, null, 2));

/**
 * 清收:按运行清单删净自建笔记与视图(带命名空间兜底扫地)、还原 filter_last 与 theme,
 * 并用三条读数收尾(清单交集为空 / 库存回到基线 / 库存洁净)。
 */
export async function cleanupRun({ call, listViews, record, j }) {
  const man = readManifest();
  const base = readBaseline();
  for (const id of man.viewIds ?? []) await call('delete_view', { id }).catch(() => {});
  for (const id of man.noteIds ?? []) await call('delete_note', { id }).catch(() => {});
  // 兜底:清单之外的命名空间数据;基线里已有同名/同正文的则跳过并 FAIL,避免误伤用户数据
  const clash = [
    ...base.viewTitles.filter((t) => t.startsWith(RUN_TAG)),
    ...base.ids.filter((x) => firstLine(x).startsWith(RUN_TAG)),
  ];
  if (clash.length > 0) {
    record('清收:「' + RUN_TAG + '」命名空间数据已存在于基线,跳过兜底删除', false, j({ clash }));
  } else {
    for (const v of (await listViews()).filter((v) => String(v.title).startsWith(RUN_TAG))) {
      await call('delete_view', { id: v.id }).catch(() => {});
    }
    for (const n of await call('query_notes', { conditions: JSON.parse(EMPTY_FILTER), offset: 0 })) {
      if (String(n.content).startsWith(RUN_TAG)) await call('delete_note', { id: n.id }).catch(() => {});
    }
  }
  // filter_last:原值可解析且引用路径都还在才装回,否则写默认条件。
  // 注意先等界面侧节流(FILTER_WRITE_DELAY 500ms + 输入防抖 300ms)落定,否则恢复会被它覆盖。
  await sleep(1600);
  const { refs, parseable } = refsOfFilter(man.filterLastBefore);
  const missing = refs.filter((r) => !(man.pathsBefore ?? []).includes(r));
  const raw = man.filterLastBefore === null || man.filterLastBefore === undefined ? '' : String(man.filterLastBefore);
  const ok = parseable && missing.length === 0 && !RESIDUE_TEXT.test(raw);
  await call('set_setting', { key: 'filter_last', value: ok && raw !== '' ? raw : EMPTY_FILTER });
  if (man.themeBefore !== undefined && man.themeBefore !== null) {
    await call('set_setting', { key: 'theme', value: man.themeBefore });
  }
  await sleep(600);
  // 收尾读数用 DB 快照(dbInventory 含 theme;IPC 库存没有这个字段)
  const after = dbInventory();
  const leftover = (man.viewIds ?? []).filter((x) => after.viewIds.includes(x)).concat(
    (man.noteIds ?? []).filter((x) => after.ids.some((line) => line.split('|')[0] === String(x)))  // 笔记 id 与视图 id 会撞号,必须按字符串比
  );
  record('清收1:运行清单断言(清单里的笔记与视图都已删净)', leftover.length === 0, j({ leftover }));
  record('清收2:库存回到基线(笔记数/标签路径/视图数与基线一致)',
    after.notes === base.notes && JSON.stringify(after.paths) === JSON.stringify(base.paths) && after.views === base.views,
    j({ notes: [after.notes, base.notes], views: [after.views, base.views] }));
  record('清收3:filter_last 与 theme 还原(口径见脚本注释)',
    (ok ? canonFilter(after.filterLast) === canonFilter(man.filterLastBefore) : canonFilter(after.filterLast) === EMPTY_FILTER) &&
      after.theme === (man.themeBefore ?? after.theme),
    j({ filterLast: after.filterLast, theme: after.theme, themeBefore: man.themeBefore }));
  const problems = auditBaseline(after);
  record('清收4:清收后库存洁净(无 AI 残留,可当下一轮基线)', problems.length === 0, j({ problems }));
  return after;
}
