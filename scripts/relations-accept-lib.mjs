// 标签关系端到端验收(scripts/dev-relations-accept.mjs)的共用件:只读库对账 / 发 IPC / 读 DOM / 画布探针;判定全留在主脚本。
// DOM 读数与画布探针在 scripts/relations-accept-cdp.mjs(自本件拆出以守 200 行上限),这里再出口。
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import {
  all, get, counts, fmt, ipc, condIds, queryCount, pressEsc, sleep, waitFor, requireApp,
  noteIdOf, tagIdOf, DB_PATH, openTagMenu, timeQuery, xlsxContentDigest, clearChips, EMPTY, appNoteTags,
} from './carry-accept-lib.mjs';
import { setSearch } from './graph-accept-g3-lib.mjs';

export * from './carry-accept-lib.mjs';
export * from './relations-accept-cdp.mjs';
export { setSearch } from './graph-accept-g3-lib.mjs';

/** 确认被测应用在跑(dev 构建命令行含 0-cargo-target,装机版含 1-LifeLog);打印实际命令行,不保守含糊。 */
export function assertDevBuild() {
  const ps = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'app-lifelog|LifeLog' } | ForEach-Object { $_.CommandLine }";
  let lines = [];
  try {
    lines = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { /* 取不到就当没确认 */ }
  console.log('INFO 进程命令行: ' + fmt(lines));
  return lines.some((l) => l.includes('0-cargo-target') || l.includes('1-LifeLog'));
}

// --- 关系条件(新字段 relations/excludeRelations;R10b 旧字段 types 只用于回读探针) ---
export const relCond = (path) => ({ ...EMPTY, relations: [{ path }] });
export const excludeRelCond = (path) => ({ ...EMPTY, excludeRelations: [{ path }] });
export const legacyRelCond = (path) => ({ ...EMPTY, types: [{ path }] });

// --- 库读数(只读) ---
export const hasIsTypeColumn = () =>
  get("SELECT COUNT(*) n FROM pragma_table_info('tags') WHERE name='is_type'").n > 0;
export const targetStates = () =>
  all('SELECT target_type, COUNT(*) n FROM tag_links GROUP BY target_type ORDER BY target_type');
export const typeEdgeRows = () => get("SELECT COUNT(*) n FROM tag_links WHERE target_type='type'").n;
export const relationRows = () =>
  all("SELECT tag_id, target_id FROM tag_links WHERE target_type='tag' ORDER BY tag_id, target_id");
export const relationRowsFrom = (id) => get("SELECT COUNT(*) n FROM tag_links WHERE target_type='tag' AND tag_id=?1", id).n;
export const relationRowsTo = (id) => get("SELECT COUNT(*) n FROM tag_links WHERE target_type='tag' AND target_id=?1", id).n;
export const danglingTagRows = () =>
  get("SELECT COUNT(*) n FROM tag_links WHERE target_type='tag' AND target_id NOT IN (SELECT id FROM tags)").n;
export const mergeLogRows = () =>
  all('SELECT id, source_tag_id, target_tag_id, moved_child_ids, note_links, edges FROM tag_merge_log ORDER BY id');
/** 树结构快照:剔除今天的时间标签(跨零点假红)与夹具命名空间 */
export const tagStructRows = (ns) =>
  all("SELECT id,path,depth,sort_order FROM tags WHERE path NOT LIKE '时间/%' ORDER BY id")
    .filter((t) => !String(t.path).includes(ns));
export const ftsTagsOf = (id) => get('SELECT tags FROM notes_fts WHERE rowid=?1', id)?.tags ?? null;
// --- 设置读写(仅往返用;设置表在真实库里。真实库只读,仅夹具清理与设置往返会写库) ---
const write = (fn) => {
  const db = new DatabaseSync(DB_PATH);
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
export const getSettingRaw = (key) => get('SELECT value FROM settings WHERE key=?1', key)?.value ?? null;
export const writeSetting = (key, value) => write((db) => db.prepare(
  'INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
).run(key, value));
export const deleteSetting = (key) => write((db) => db.prepare('DELETE FROM settings WHERE key=?1').run(key));
/** 删掉夹具自动合并留下的日志行(entity_merge_log 只增不改,收尾要零残留;id 已是实体 id) */
export const deleteMergeLogFor = (ids) => {
  if (ids.length === 0) return 0;
  const marks = ids.map(() => '?').join(',');
  return write((db) => db.prepare(
    `DELETE FROM entity_merge_log WHERE source_entity_id IN (${marks}) OR target_entity_id IN (${marks})`
  ).run(...ids, ...ids).changes);
};

// --- 夹具(前缀 关系测试,自建自删) ---
export const NS = '关系测试';
export const FIX = {
  A: `${NS}甲`, AS: `${NS}甲/子`,
  B_PLAIN: `${NS}乙`, B_RAW: `[${NS}乙](${NS}备注词)`, REMARK: `${NS}备注词`,
  C: `${NS}丙`, D: `${NS}丁`,
  PARENT: `${NS}父`, DUP: `${NS}同名`, DUP_CHILD: `${NS}父/${NS}同名`, DUP_GRAND: `${NS}同名/子`,
};
/** 夹具笔记(标题, 要挂的标签):都走真实保存路径 */
export const FIXTURE_NOTES = [
  [`${NS}甲笔记`, FIX.A], [`${NS}甲子笔记`, FIX.AS], [`${NS}乙笔记`, FIX.B_PLAIN],
  [`${NS}丙笔记`, FIX.C], [`${NS}丁笔记`, FIX.D], [`${NS}同名根笔记`, FIX.DUP],
  [`${NS}同名子笔记`, FIX.DUP_CHILD], [`${NS}同名孙笔记`, FIX.DUP_GRAND],
];
export async function raiseFixtures(call) {
  for (const [title, tag] of FIXTURE_NOTES) await call('save_input_note', { content: `${title}\n#${tag}` });
  await sleep(300);
  // 目标标签名带 md 备注:验「行内只显示剥壳后的值」;属性名改由边上的 remark 提供(迁移 023),不再取名字备注
  const b = tagIdOf(FIX.B_PLAIN);
  if (b != null) await call('rename_tag', { tagId: b, newName: FIX.B_RAW });
  await sleep(300);
}
export const fixtureNoteIds = () =>
  all("SELECT id FROM notes WHERE content LIKE '关系测试%' ORDER BY id").map((r) => r.id);
export const fixtureTagIds = () =>
  all("SELECT id FROM tags WHERE path LIKE '关系测试%' ORDER BY depth DESC").map((r) => r.id);
export async function purgeFixtures(call) {
  for (const id of fixtureNoteIds()) await call('delete_note', { id }).catch(() => null);
  for (const id of fixtureTagIds()) await call('delete_tag', { tagId: id }).catch(() => null);
}
