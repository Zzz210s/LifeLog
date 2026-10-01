#!/usr/bin/env node
/**
 * 笔记间链接 L1 的真机读数(计划 2026-10-01-note-links-l1.md 的 Task 4)。
 *   1 用统一输入框写一条含 `[[<目标首行>]]` 的笔记 -> note_links 恰 1 行、target_id 指向目标、raw_title 原样
 *   5 围栏代码块里的 `[[X]]` 不产生 note_links 行
 *   6 改目标笔记首行 -> 链接仍在(target_id 不变,raw_title 仍是原文)
 *   7 删目标笔记 -> 该链接退回未解析(target_id 变 NULL)
 *   8 标签形 `[[#工作/]]` 不建链(设计 §5.5,不写永久垃圾行)
 *   收尾 夹具删净 + 库对账(notes/tags/tag_links/notes_fts/note_links 逐项回到基线 + integrity_check)
 *
 * 夹具一律 `LINK测试` 前缀,自建自删;真实库除本脚本自建的笔记外只读。
 * 键鼠全走 CDP 合成事件(不碰物理鼠标);建笔记走真实保存路径(统一输入框 + Ctrl+Enter),
 * 改名/删除走真实 IPC 命令(与界面调用同一条通道)。
 * 用法:LIFELOG_CDP_PORT=9222 node scripts/dev-links-accept.mjs(先起 pnpm tauri dev)
 */
import { DatabaseSync } from 'node:sqlite';
import { CDP_PORT, ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { BOX, driver } from './unified-accept-lib.mjs';

const NS = 'LINK测试';
const DB_PATH = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
const TARGET = `${NS} 目标`;
const RENAMED = `${NS} 目标改`;
const SOURCE = `${NS} 源 [[${TARGET}]]`;
const FENCED = `${NS} 围栏\n\`\`\`\n[[${TARGET}]]\n\`\`\``;
const TAG_SHAPED = `${NS} 标签形 [[#工作/]]`;

/** 只读开一次:不吃旧连接里的 WAL 快照(应用在跑,写提交后立刻能读到) */
const ro = (fn) => {
  const db = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
const all = (sql, ...args) => ro((db) => db.prepare(sql).all(...args));
const get = (sql, ...args) => ro((db) => db.prepare(sql).get(...args));

/** 库存计数 + 完整性(对账基线) */
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

/** 某个来源的链接行(目标已删时 target_body 为空 —— LEFT JOIN) */
const linkRows = (sourceId) =>
  all(
    `SELECT l.target_id, l.raw_title, t.content AS target_body FROM note_links l
     LEFT JOIN notes t ON t.id = l.target_id WHERE l.source_id = ?1 ORDER BY l.id`,
    sourceId
  );

/** 自建夹具(按正文前缀认领,不碰用户笔记) */
const fixtureIds = () => all(`SELECT id FROM notes WHERE content LIKE '${NS}%' ORDER BY id`).map((r) => r.id);

const r = recorder();
const { record, finish } = r;
const fmt = (v) => JSON.stringify(v);

if (!(await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((x) => x.ok, () => false))) {
  console.log(`需要先起应用:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${CDP_PORT}" pnpm tauri dev`);
  process.exit(2);
}

const conn = await ensureMain();
const call = (cmd, args = {}) =>
  conn.cdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const d = driver(conn.cdp);
await conn.cdp.send('Page.reload');
await waitFor(() => d.ev(`!!document.querySelector('${BOX}')`).catch(() => false), 60, 500);
await sleep(1200);

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

let failure = null;
// 上一次中断可能留下的夹具:先清掉再取基线(只动 LINK测试 命名空间)
const stale = fixtureIds();
if (stale.length) console.log(`INFO 清掉上一次残留夹具 ${stale.length} 条`);
for (const id of stale) await call('delete_note', { id });
await sleep(400);
if (stale.length) record('前置 上次中断残留的夹具已清', stale.length > 0, `清除 ${stale.length} 条`);
const base = counts();
console.log(`INFO 基线=${fmt(base)}`);

try {
  const targetId = await createNote(TARGET);
  const sourceId = await createNote(SOURCE);
  console.log(`INFO 夹具 id:目标=${targetId} 源=${sourceId}`);

  // --- 读数 1:保存时同事务解析链接 ---
  const rows1 = linkRows(sourceId);
  record(
    '读数1 保存即建链(note_links 恰 1 行 / target_id 正确 / raw_title 原样)',
    rows1.length === 1 && rows1[0].target_id === targetId && rows1[0].raw_title === TARGET,
    `行数=${rows1.length}(期望 1) target_id=${fmt(rows1[0]?.target_id)}(期望 ${targetId}) raw_title=${fmt(rows1[0]?.raw_title)}`
  );

  // --- 读数 5:围栏代码块里不算 ---
  const fencedId = await createNote(FENCED);
  const rows5 = linkRows(fencedId);
  record('读数5 围栏代码块里的 [[X]] 不建链', rows5.length === 0, `行数=${rows5.length}(期望 0)`);

  // --- 读数 8:标签形 `[[#x]]` 不算(设计 §5.5) ---
  const shapedId = await createNote(TAG_SHAPED);
  const rows8 = linkRows(shapedId);
  record('读数8 标签形 [[#工作/]] 不建链(设计 5.5)', rows8.length === 0, `行数=${rows8.length}(期望 0)`);

  // --- 读数 6:目标改名,链接靠 id 存活 ---
  await call('update_note', { id: targetId, content: RENAMED });
  const rows6 = linkRows(sourceId);
  record(
    '读数6 改目标首行 -> 链接仍在(target_id 不变)',
    rows6.length === 1 && rows6[0].target_id === targetId && rows6[0].raw_title === TARGET,
    `行数=${rows6.length} target_id=${fmt(rows6[0]?.target_id)}(期望 ${targetId}) raw_title=${fmt(rows6[0]?.raw_title)} 目标当前正文=${fmt(rows6[0]?.target_body)}`
  );

  // --- 读数 7:删目标 -> 退回未解析 ---
  await call('delete_note', { id: targetId });
  const rows7 =
    (await waitFor(async () => {
      const rs = linkRows(sourceId);
      return rs.length === 1 && rs[0].target_id === null ? rs : null;
    }, 12, 250)) ?? linkRows(sourceId);
  record(
    '读数7 删目标 -> target_id 变 NULL(靠 ON DELETE SET NULL)',
    rows7.length === 1 && rows7[0].target_id === null && rows7[0].raw_title === TARGET,
    `行数=${rows7.length} target_id=${fmt(rows7[0]?.target_id)} raw_title=${fmt(rows7[0]?.raw_title)}`
  );
} catch (e) {
  failure = e;
} finally {
  // --- 收尾(必跑):删净夹具 + 库对账 ---
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
