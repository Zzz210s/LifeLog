// 标签关系端到端验收(scripts/dev-relations-accept.mjs)的共用件:只读库对账 / 发 IPC / 读 DOM /
// 画布探针。判定全部留在主脚本(与 types-accept-lib 同风格)。
// 真实库只读;仅夹具清理与设置往返会写库(见 writeSetting/deleteSetting/deleteMergeLogFor)。
import { DatabaseSync } from 'node:sqlite';
import {
  all, get, counts, fmt, ipc, condIds, queryCount, pressEsc, sleep, waitFor, requireApp,
  noteIdOf, tagIdOf, DB_PATH, openTagMenu, timeQuery, xlsxContentDigest, clearChips, EMPTY, appNoteTags,
} from './carry-accept-lib.mjs';
import { setSearch } from './graph-accept-g3-lib.mjs';

export {
  all, get, counts, fmt, ipc, condIds, queryCount, pressEsc, sleep, waitFor, requireApp,
  noteIdOf, tagIdOf, DB_PATH, openTagMenu, timeQuery, xlsxContentDigest, clearChips, EMPTY, setSearch, appNoteTags,
};

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
export const relationRowsFrom = (id) =>
  get("SELECT COUNT(*) n FROM tag_links WHERE target_type='tag' AND tag_id=?1", id).n;
export const relationRowsTo = (id) =>
  get("SELECT COUNT(*) n FROM tag_links WHERE target_type='tag' AND target_id=?1", id).n;
export const danglingTagRows = () =>
  get("SELECT COUNT(*) n FROM tag_links WHERE target_type='tag' AND target_id NOT IN (SELECT id FROM tags)").n;
export const mergeLogRows = () =>
  all('SELECT id, source_tag_id, target_tag_id, moved_child_ids, note_links, edges FROM tag_merge_log ORDER BY id');
/** 树结构快照:剔除今天的时间标签(跨零点假红)与夹具命名空间 */
export const tagStructRows = (ns) =>
  all("SELECT id,path,depth,sort_order FROM tags WHERE path NOT LIKE '时间/%' ORDER BY id")
    .filter((t) => !String(t.path).includes(ns));
export const ftsTagsOf = (id) => get('SELECT tags FROM notes_fts WHERE rowid=?1', id)?.tags ?? null;

// --- 设置读写(仅往返用;设置表在真实库里) ---
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
/** 删掉夹具自动合并留下的日志行(表只增不改,收尾要零残留) */
export const deleteMergeLogFor = (ids) => {
  if (ids.length === 0) return 0;
  const marks = ids.map(() => '?').join(',');
  return write((db) => db.prepare(
    `DELETE FROM tag_merge_log WHERE source_tag_id IN (${marks}) OR target_tag_id IN (${marks})`
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
  // 目标标签的名字备注:纯文本建好后改名成 md 形态(remark 由名字里的链接备注而来)
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

// --- DOM 读数(判定留在主脚本) ---
const sel = (name, value) => `[${name}=' + JSON.stringify(${JSON.stringify(value)}) + ']`;
/** 侧栏某行末尾的关系小字(开关打开后才有;null = 行不在) */
export const relationChipsOf = (cdp, path) =>
  cdp.eval(`(() => { const r = document.querySelector('aside ${sel('data-tag-path', path)}');
    return r ? Array.from(r.querySelectorAll('[data-tag-relation]')).map((x) => x.textContent.trim()) : null; })()`);
/** 侧栏某行的悬浮卡片文本(data-tip 多行) */
export const rowTipOf = (cdp, path) =>
  cdp.eval(`(() => { const r = document.querySelector('aside ${sel('data-tag-path', path)}');
    return r ? r.getAttribute('data-tip') : null; })()`);
/** 标签右键菜单的按钮文案(主面板应为五档) */
export const menuItemsOf = (cdp) =>
  cdp.eval(`(() => { const m = document.querySelector('[data-tag-menu]');
    return m ? Array.from(m.querySelectorAll('button')).map((b) => b.textContent.trim()).filter(Boolean) : null; })()`);
/** 设置页「标签树里显示关系」开关的 aria-checked */
export const relToggleState = (cdp) =>
  cdp.eval(`document.querySelector('button[aria-label="标签树里显示关系"]')?.getAttribute('aria-checked') ?? null`);
export const clickByLabelIn = (cdp, label) =>
  cdp.eval(`(() => { const b = document.querySelector('button[aria-label=' + JSON.stringify(${JSON.stringify(label)}) + ']');
    if (!b) return false; b.click(); return true; })()`);
export const openSettings = async (cdp) => {
  await clickByLabelIn(cdp, '设置');
  return waitFor(() => cdp.eval(`!!document.querySelector('[data-section-nav="types"]')`), 20, 200);
};
export const pickRelationSection = (cdp) =>
  cdp.eval(`(() => { const b = document.querySelector('[data-section-nav="types"]'); if (!b) return false; b.click(); return true; })()`);
export const backToStream = (cdp) =>
  cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '返回信息流');
    if (!b) return false; b.click(); return true; })()`);
/** 关系图信息条的关系出/入度行 */
export const relationDegreesText = (cdp) =>
  cdp.eval(`document.querySelector('[data-testid="graph-relation-degrees"]')?.textContent ?? null`);
export const graphOpened = (cdp) => cdp.eval(`!!document.querySelector('[data-testid="graph-view"] canvas')`);

// --- 画布探针:关系边箭头 = 三顶点路径 fill;备注文字走 fillText ---
export const installRelationProbe = (cdp) =>
  cdp.eval(`(() => {
    if (window.__relV === 1) return true;
    const fresh = () => ({ segs: 0, arrowHeads: 0, texts: [] });
    let cur = fresh();
    const st = { get: () => cur };
    const mine = (c) => c.canvas && c.canvas.closest && c.canvas.closest('[data-testid="graph-view"]') !== null;
    const P = CanvasRenderingContext2D.prototype;
    const real = {};
    for (const m of ['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillText']) real[m] = P[m];
    let verts = 0;
    P.clearRect = function (...a) {
      if (mine(this) && (cur.segs || cur.arrowHeads || cur.texts.length)) cur = fresh();
      return real.clearRect.apply(this, a);
    };
    P.beginPath = function (...a) { verts = 0; return real.beginPath.apply(this, a); };
    P.moveTo = function (x, y, ...r) { verts = 1; return real.moveTo.call(this, x, y, ...r); };
    P.lineTo = function (x, y, ...r) { verts += 1; return real.lineTo.call(this, x, y, ...r); };
    P.stroke = function (...a) { if (mine(this) && verts >= 2) cur.segs += 1; return real.stroke.apply(this, a); };
    P.fill = function (...a) { if (mine(this) && verts === 3) cur.arrowHeads += 1; return real.fill.apply(this, a); };
    P.fillText = function (t, ...a) { if (mine(this)) cur.texts.push(String(t)); return real.fillText.call(this, t, ...a); };
    window.__rel = st; window.__relV = 1; return true;
  })()`);
export const relationFrame = (cdp) => cdp.eval('window.__rel ? window.__rel.get() : null');
/** 在画布中心连发滚轮缩放(delta < 0 放大);每格等一帧 */
export const zoomBy = (cdp, ticks, delta) =>
  cdp.eval(`(async () => {
    const el = document.querySelector('[data-testid="graph-view"]');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    for (let i = 0; i < ${ticks}; i++) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: ${delta}, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      await new Promise((res) => requestAnimationFrame(res));
    }
    return true;
  })()`);
/** 点图内搜索第一条候选(mousedown 才走组件的 onPick) */
export const pickSearchItem = (cdp) =>
  cdp.eval(`(() => { const b = document.querySelector('[data-testid="graph-search-item"]');
    if (!b) return false; b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true; })()`);
