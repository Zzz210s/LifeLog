// 冷启动/启动路径验收(scripts/dev-cdp-accept-startup.mjs)的数据安全件:
// 只读库存快照、基线洁净审计、运行清单、清收(删清单里的笔记 + 还原 filter_current/theme)。
// 原则:只动脚本自建的数据;任何可疑情况(基线有 AI 残留 / 清单与基线撞车 / 原值失效)
// 一律记 FAIL 并保守处理,绝不静默删用户数据。
// 注:保存视图与 `filter_last` 已随迁移 014 删除;多页筛选快照随迁移 016 迁成单份 `filter_current`,
// 故快照/审计/还原读 `filter_current` 原文。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sleep } from './cdp-lib.mjs';

/** 验收产物目录(基线 / 运行清单,在 .superpowers/ 下、不入库) */
export const OUT = '.superpowers/startup4';
/** 自建数据命名空间:笔记正文前缀,清收只认它 */
export const RUN_TAG = '启动验收';
export const TEST_NOTE = RUN_TAG + '输入栏保存';
/** 真实库(工程约定路径) */
export const DB_PATH = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
/** 条件的归一化键(与前端 EMPTY_FILTER 同键序;日期键 from/to 已随 D2 删除) */
const EMPTY_CONDITIONS = { keyword: null, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null };
/** 空条件对象(IPC query_notes 用) */
export const EMPTY_FILTER = JSON.stringify(EMPTY_CONDITIONS);
const RESIDUE_TEXT = /验收|CDP|图标测试/;
const RESIDUE_TAG = /^(验收|图标验收|表达式测试|启动验收|临时|P5回归)(\/|$)/;
const firstLine = (idLine) => idLine.slice(idLine.indexOf('|') + 1);

/** 单个条件对象 → 归一化 JSON(键序固定,filter_current 逐键对照才可比) */
const canonConditions = (o) => JSON.stringify({ ...EMPTY_CONDITIONS, ...(o && typeof o === 'object' ? o : {}) });

/** `filter_current` 原文 → 归一化 JSON(缺失/空白 = 默认空条件;非法 = INVALID 前缀便于报错) */
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

/** `filter_current` 引用的标签路径(tags/excludeTags 的 path + 表达式里的 #路径) */
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
    for (const t of Array.isArray(c[key]) ? c[key] : []) if (t && typeof t.path === 'string') refs.push(t.path);
  }
  for (const m of String(c.expr ?? '').matchAll(/#=?([^\s()]+)/g)) refs.push(m[1]);
  return { refs: [...new Set(refs)], parseable: true };
}

/** 只读库存快照:笔记数/id|首行、标签路径、filter_current、theme、user_version(全部走 SQLite,不依赖窗口) */
export function dbInventory() {
  const db = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
  try {
    const notes = db.prepare('SELECT id, content FROM notes ORDER BY id').all();
    const tags = db.prepare('SELECT path FROM tags').all().map((t) => t.path).sort();
    const get = (k) => {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
      return row ? row.value : null;
    };
    return {
      notes: notes.length,
      ids: notes.map((n) => n.id + '|' + String(n.content).split('\n')[0]).sort(),
      paths: tags,
      filterCurrent: get('filter_current'),
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
  const { refs, parseable } = refsOfFilter(inv.filterCurrent);
  if (!parseable) problems.push(`filter_current 非法 JSON: ${inv.filterCurrent}`);
  for (const r of refs) if (!inv.paths.includes(r)) problems.push(`filter_current 引用了不存在的路径: ${r}`);
  return problems;
}

export const readManifest = () => JSON.parse(readFileSync(join(OUT, 'run-manifest.json'), 'utf8'));
export const readBaseline = () => JSON.parse(readFileSync(join(OUT, 'inventory-before.json'), 'utf8'));
export const writeJson = (name, value) => writeFileSync(join(OUT, name), JSON.stringify(value, null, 2));

/**
 * 清收:按运行清单删净自建笔记(带命名空间兜底扫地)、还原 filter_current 与 theme,
 * 并用四条读数收尾(清单交集为空 / 库存回到基线 / filter_current 与 theme 还原 / 库存洁净)。
 */
export async function cleanupRun({ call, record, j }) {
  const man = readManifest();
  const base = readBaseline();
  for (const id of man.noteIds ?? []) await call('delete_note', { id }).catch(() => {});
  // 兜底:清单之外的命名空间数据;基线里已有同正文的则跳过并 FAIL,避免误伤用户数据
  const clash = base.ids.filter((x) => firstLine(x).startsWith(RUN_TAG));
  if (clash.length > 0) {
    record('清收:「' + RUN_TAG + '」命名空间数据已存在于基线,跳过兜底删除', false, j({ clash }));
  } else {
    for (const n of await call('query_notes', { conditions: JSON.parse(EMPTY_FILTER), offset: 0 })) {
      if (String(n.content).startsWith(RUN_TAG)) await call('delete_note', { id: n.id }).catch(() => {});
    }
  }
  // filter_current:原值可解析且引用路径都还在才装回,否则写默认空条件。
  // 注意先等界面侧节流(500ms 写回 + 输入防抖 300ms)落定,否则恢复会被它覆盖。
  await sleep(1600);
  const { refs, parseable } = refsOfFilter(man.filterBefore);
  const missing = refs.filter((r) => !(man.pathsBefore ?? []).includes(r));
  const raw = man.filterBefore === null || man.filterBefore === undefined ? '' : String(man.filterBefore);
  const ok = parseable && missing.length === 0 && !RESIDUE_TEXT.test(raw);
  await call('set_setting', { key: 'filter_current', value: ok && raw !== '' ? raw : EMPTY_FILTER });
  if (man.themeBefore !== undefined && man.themeBefore !== null) {
    await call('set_setting', { key: 'theme', value: man.themeBefore });
  }
  await sleep(600);
  // 收尾读数用 DB 快照(dbInventory 含 theme;IPC 库存没有这个字段)
  const after = dbInventory();
  const leftover = (man.noteIds ?? []).filter((x) => after.ids.some((line) => line.split('|')[0] === String(x)));
  record('清收1:运行清单断言(清单里的笔记都已删净)', leftover.length === 0, j({ leftover }));
  record('清收2:库存回到基线(笔记数/标签路径与基线一致)',
    after.notes === base.notes && JSON.stringify(after.paths) === JSON.stringify(base.paths),
    j({ notes: [after.notes, base.notes], pathsSame: JSON.stringify(after.paths) === JSON.stringify(base.paths) }));
  record('清收3:filter_current 与 theme 还原(口径见脚本注释)',
    (ok ? canonFilter(after.filterCurrent) === canonFilter(man.filterBefore) : canonFilter(after.filterCurrent) === EMPTY_FILTER) &&
      after.theme === (man.themeBefore ?? after.theme),
    j({ filterCurrent: after.filterCurrent, theme: after.theme, themeBefore: man.themeBefore }));
  const problems = auditBaseline(after);
  record('清收4:清收后库存洁净(无 AI 残留,可当下一轮基线)', problems.length === 0, j({ problems }));
  return after;
}
