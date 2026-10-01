#!/usr/bin/env node
/**
 * 笔记间链接 L3 的真机读数(设计 2026-10-01-note-links-design.md §6 的读数 2/3,D11)。
 *   2 目标笔记卡片底部出现「被引用 2」(被两条来源引用)-> 点开面板恰好列出两条来源首行
 *   3 点面板里的来源条目 -> 复用 L2 快速打开:来源行滚进视野并临时高亮;
 *     库 `note_links` 恰两行、target_id 指向目标;不进编辑态
 *   收尾 夹具删净 + 库对账(notes/tags/tag_links/notes_fts/note_links 逐项回基线 + integrity)
 *
 * 夹具一律 `LINK测试` 前缀,自建自删;真实库除本脚本自建的笔记外只读。
 * 点按钮/点条目走 DOM `.click()`(合成,不碰物理鼠标),命中与渲染同源。
 * 用法:LIFELOG_CDP_PORT=9222 node scripts/dev-links-accept-l3.mjs(先起 pnpm tauri dev)
 */
import { DatabaseSync } from 'node:sqlite';
import { CDP_PORT, ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { BOX, driver } from './unified-accept-lib.mjs';

const NS = 'LINK测试';
const DB_PATH = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
const TARGET = `${NS} L3目标`;
const S1 = `${NS} L3来源甲`;
const S2 = `${NS} L3来源乙`;
const SOURCE1 = `${S1}\n[[${TARGET}]]`;
const SOURCE2 = `${S2}\n[[${TARGET}]]`;

const ro = (fn) => {
  const db = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
const get = (sql, ...args) => ro((db) => db.prepare(sql).get(...args));
const all = (sql, ...args) => ro((db) => db.prepare(sql).all(...args));

const counts = () =>
  ro((db) => {
    const n = (sql) => db.prepare(sql).get().n;
    return {
      notes: n('SELECT COUNT(*) n FROM notes'),
      tags: n('SELECT COUNT(*) n FROM tags'),
      tagLinks: n('SELECT COUNT(*) n FROM tag_links'),
      fts: n('SELECT COUNT(*) n FROM notes_fts'),
      noteLinks: n('SELECT COUNT(*) n FROM note_links'),
      version: db.prepare('PRAGMA user_version').get().user_version,
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    };
  });

const fixtureIds = () => all(`SELECT id FROM notes WHERE content LIKE '${NS}%' ORDER BY id`).map((r) => r.id);
const fmt = (v) => JSON.stringify(v);

const r = recorder();
const { record, finish } = r;

if (!(await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((x) => x.ok, () => false))) {
  console.log(`需要先起应用:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${CDP_PORT}" pnpm tauri dev`);
  process.exit(2);
}

const conn = await ensureMain();
const call = (cmd, args = {}) =>
  conn.cdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const d = driver(conn.cdp);

/** 回信息流:退编辑态 + 清掉条件栏全部 chip + 重载(否则新笔记可能不在 DOM 里) */
const gotoStream = async () => {
  await d.esc();
  await d.clearChips();
  await conn.cdp.send('Page.reload');
  await waitFor(() => d.ev(`!!document.querySelector('${BOX}')`).catch(() => false), 60, 500);
  await sleep(1200);
};

/** 走真实保存路径建笔记(统一输入框 + Ctrl+Enter),返回落库 id */
const createNote = async (text) => {
  await d.clearBox();
  await d.type(text);
  await d.ctrlEnter();
  const id = await waitFor(
    () => get('SELECT id FROM notes WHERE content = ?1 ORDER BY id DESC LIMIT 1', text)?.id,
    24,
    250
  );
  if (id == null) throw new Error(`建笔记失败:库里找不到正文等于 ${fmt(text)} 的行`);
  return id;
};

const cardOf = (id) => `document.querySelector('[data-note-body="${id}"]')?.closest('li')`;
const readButton = (id) =>
  d.ev(`(() => { const b = ${cardOf(id)}?.querySelector('[data-testid="backlink-count"]');
    return b ? { text: b.textContent.trim(), expanded: b.getAttribute('aria-expanded') } : null; })()`);
const clickButton = (id) =>
  d.ev(`(() => { const b = ${cardOf(id)}?.querySelector('[data-testid="backlink-count"]'); if (!b) return false; b.click(); return true; })()`);
const readPanel = (id) =>
  d.ev(`(() => { const p = ${cardOf(id)}?.querySelector('[data-testid="backlinks-panel"]');
    return p ? Array.from(p.querySelectorAll('button')).map((b) => b.textContent.trim()) : null; })()`);
/** 点条目并**在同一次求值里**读来源行类名(高亮同步落地,分次读会被重渲染冲掉) */
const clickSourceAndRead = (id, title, sourceId) =>
  d.ev(`(() => { const items = Array.from(${cardOf(id)}?.querySelectorAll('[data-testid="backlinks-panel"] button') ?? []);
    const b = items.find((x) => x.textContent.trim() === ${JSON.stringify(title)}); if (!b) return { clicked: false };
    b.click();
    const row = document.querySelector('[data-note-body="${sourceId}"]')?.closest('li');
    return { clicked: true, found: !!row, cls: row?.className ?? null }; })()`);

let failure = null;
const stale = fixtureIds();
if (stale.length) console.log(`INFO 清掉上一次残留夹具 ${stale.length} 条`);
for (const id of stale) await call('delete_note', { id });
await sleep(400);
const base = counts();
console.log(`INFO 基线=${fmt(base)}`);

try {
  await gotoStream();
  const targetId = await createNote(TARGET);
  const source1Id = await createNote(SOURCE1);
  const source2Id = await createNote(SOURCE2);
  console.log(`INFO 夹具 id:目标=${targetId} 来源甲=${source1Id} 来源乙=${source2Id}`);

  // --- 读数 2:目标卡片显示「被引用 2」;点开列出两条来源 ---
  const btn = await waitFor(() => readButton(targetId).then((x) => (x?.text === '被引用 2' ? x : null)), 30, 300);
  const beforeClick = await readButton(targetId);
  await clickButton(targetId);
  const items = await waitFor(() => readPanel(targetId), 16, 300);
  const expanded = (await readButton(targetId))?.expanded;
  const sorted = (items ?? []).slice().sort();
  record(
    '读数2 目标卡片显示「被引用 2」(未点开时不展开) -> 点开恰好列出两条来源首行',
    beforeClick?.text === '被引用 2' &&
      beforeClick?.expanded === 'false' &&
      expanded === 'true' &&
      fmt(sorted) === fmt([S1, S2].sort()),
    `按钮改前=${fmt(beforeClick)} 按钮改后展开=${fmt(expanded)} 面板条目=${fmt(items)}`
  );

  // --- 读数 3:点条目跳转(来源行进视野 + 高亮),进编辑=false;库两行 ---
  const jumped = await clickSourceAndRead(targetId, S1, source1Id);
  const inView = await d.noteInView(source1Id);
  const cls = jumped.cls;
  const editOpen = await d.ev(`!!document.querySelector('[data-testid="edit-panel"]')`);
  const rows = all(
    `SELECT l.source_id, l.target_id, l.raw_title FROM note_links l WHERE l.target_id = ?1 ORDER BY l.source_id`,
    targetId
  );
  record(
    '读数3 点来源条目跳转成功(来源行在视野内 + 高亮),不进编辑;库 note_links 恰两行指向目标',
    btn !== null &&
      jumped.clicked === true &&
      jumped.found === true &&
      inView?.found === true &&
      inView?.inView === true &&
      cls?.includes('bg-accent-soft') === true &&
      editOpen === false &&
      rows.length === 2 &&
      rows.every((x) => x.target_id === targetId) &&
      fmt(rows.map((x) => x.source_id)) === fmt([source1Id, source2Id]),
    `点中=${jumped.clicked} 来源行在视野内=${fmt(inView)} 行类名=${fmt(cls)} 进编辑=${editOpen} 库行=${fmt(rows)}`
  );
} catch (e) {
  failure = e;
} finally {
  for (const id of fixtureIds()) await call('delete_note', { id });
  const gone = await waitFor(() => (fixtureIds().length === 0 ? true : null), 12, 250);
  const after = counts();
  const diff = ['notes', 'tags', 'tagLinks', 'fts', 'noteLinks'].filter((k) => after[k] !== base[k]);
  record(
    '收尾 夹具删净 + 库对账(逐项回到基线 + integrity + user_version)',
    gone === true && diff.length === 0 && after.integrity === 'ok' && after.version === 19,
    `残留夹具=${fmt(fixtureIds())} 不一致=${fmt(diff.map((k) => `${k} ${base[k]}->${after[k]}`))} 基线=${fmt(base)} 收尾=${fmt(after)}`
  );
}

if (failure) record('异常中断', false, String(failure?.message ?? failure));
finish();
conn.close();
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
