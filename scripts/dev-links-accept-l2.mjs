#!/usr/bin/env node
import { openReadOnly } from './db-compat.mjs';
/**
 * 笔记间链接 L2 的真机读数(设计 2026-10-01-note-links-design.md §6 的读数 2/4)。
 *   2 正文里 `[[<目标首行>]]` 渲成已解析 chip(text-accent + data-note-link=目标 id);
 *     点它复用快速打开:目标行滚进视野并临时高亮(bg-accent-soft);note_links 恰 1 行且 target_id 正确
 *   4 正文里 `[[不存在的标题]]` 渲成未解析 chip(text-muted + 虚线 + 空 data-note-link);
 *     点它 -> 统一输入框预填 `@` + 原文
 *   收尾 夹具删净 + 库对账(notes/tags/tag_links/notes_fts/note_links 逐项回基线 + integrity)
 *
 * 夹具一律 `LINK测试` 前缀,自建自删;真实库除本脚本自建的笔记外只读。
 * 点 chip 走 DOM `.click()`(合成,不碰物理鼠标),命中与渲染同源。
 * 用法:LIFELOG_CDP_PORT=9222 node scripts/dev-links-accept-l2.mjs(先起 pnpm tauri dev)
 */
import { DatabaseSync } from 'node:sqlite';
import { CDP_PORT, ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { BOX, driver } from './unified-accept-lib.mjs';

const NS = 'LINK测试';
const DB_PATH = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
const TARGET = `${NS} 目标`;
const SOURCE = `${NS} 源 [[${TARGET}]]`;
const UNRESOLVED_TITLE = `${NS} 不存在`;
const UNRESOLVED = `${NS} 未解析 [[${UNRESOLVED_TITLE}]]`;

/** 只读开一次:不吃旧连接里的 WAL 快照(应用在跑,写提交后立刻能读到) */
const ro = (fn) => {
  const db = openReadOnly(DB_PATH);
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

const linkRows = (sourceId) =>
  all(
    `SELECT l.target_id, l.raw_title FROM note_links l WHERE l.source_id = ?1 ORDER BY l.id`,
    sourceId
  );

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

/** 回信息流:退编辑态 + 清掉条件栏全部 chip(否则新笔记可能不在 DOM 里) */
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

/** 某条来源卡片里的 chip 读数(缩到该卡内,避免别的笔记的 chip 干扰) */
const chipInfo = (sourceId, selector) =>
  d.ev(`(() => { const el = document.querySelector('[data-note-body="${sourceId}"] ${selector}');
    if (!el) return null;
    return { id: el.getAttribute('data-note-link'), cls: el.className, text: el.textContent.trim() }; })()`);

/** 点某条来源卡片里的 chip,并读点后该卡内目标行的类名(高亮证据) */
const clickChip = (sourceId, selector, targetBodyId) =>
  d.ev(`(() => { const chip = document.querySelector('[data-note-body="${sourceId}"] ${selector}');
    if (!chip) return { err: 'no-chip' };
    chip.click();
    const row = document.querySelector('[data-note-body="${targetBodyId}"]')?.closest('li');
    return { cls: row?.className ?? '', found: !!row }; })()`);

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
  const sourceId = await createNote(SOURCE);
  const unresolvedId = await createNote(UNRESOLVED);
  console.log(`INFO 夹具 id:目标=${targetId} 源=${sourceId} 未解析=${unresolvedId}`);
  await waitFor(
    () => d.ev(`!!document.querySelector('[data-note-body="${sourceId}"] [data-note-link="${targetId}"]')`),
    12,
    400
  );

  // --- 读数 2:已解析 chip 的样式 + 跳转(滚动 + 高亮)---
  const resolvedChip = await chipInfo(sourceId, `[data-note-link="${targetId}"]`);
  const clicked = await clickChip(sourceId, `[data-note-link="${targetId}"]`, targetId);
  const inView = await d.noteInView(targetId);
  // 点 chip 不能顺带把来源卡片变成编辑态(body-click 的交互元素守卫要认识 chip)
  const editOpen = await d.ev(`!!document.querySelector('[data-testid="edit-panel"]')`);
  const rows2 = linkRows(sourceId);
  record(
    '读数2 已解析 chip(text-accent + data-note-link=目标 id)点击跳到目标(高亮 + 在视野内,不进编辑)',
    resolvedChip?.id === String(targetId) &&
      resolvedChip?.cls.includes('text-accent') &&
      clicked.found === true &&
      clicked.cls.includes('bg-accent-soft') &&
      inView.found === true &&
      inView.inView === true &&
      editOpen === false &&
      rows2.length === 1 &&
      rows2[0].target_id === targetId,
    `chip=${fmt(resolvedChip)} 目标行类名=${fmt(clicked.cls)} 在视野内=${fmt(inView)} 进编辑=${editOpen} 库行=${fmt(rows2)}`
  );

  // --- 读数 4:未解析 chip 的样式 + 点击预填 `@` 原文 ---
  const unresolvedChip = await chipInfo(unresolvedId, '[data-note-link=""]');
  await clickChip(unresolvedId, '[data-note-link=""]', -1);
  const boxValue = await waitFor(async () => {
    const v = await d.boxValue();
    return v === `@${UNRESOLVED_TITLE}` ? v : null;
  }, 12, 250);
  record(
    '读数4 未解析 chip(text-muted + 虚线 + 空 id)点击 -> 统一输入框预填 `@` + 原文',
    unresolvedChip?.id === '' &&
      unresolvedChip?.cls.includes('text-muted') &&
      unresolvedChip?.cls.includes('decoration-dashed') &&
      boxValue === `@${UNRESOLVED_TITLE}`,
    `chip=${fmt(unresolvedChip)} 输入框=${fmt(boxValue)}(期望 ${fmt(`@${UNRESOLVED_TITLE}`)})`
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
    gone === true && diff.length === 0 && after.integrity === 'ok' && after.version === 27,
    `残留夹具=${fmt(fixtureIds())} 不一致=${fmt(diff.map((k) => `${k} ${base[k]}->${after[k]}`))} 基线=${fmt(base)} 收尾=${fmt(after)}`
  );
}

if (failure) record('异常中断', false, String(failure?.message ?? failure));
finish();
conn.close();
