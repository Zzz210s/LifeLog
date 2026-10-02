#!/usr/bin/env node
/**
 * `[[` 自动补全 N2(统一输入框接线)的真机读数(设计 2026-10-01-link-autocomplete-design.md 的 1/4/5/7;
 * 读数 6「候选不含正在编辑的自己」在统一输入框上不适用 —— 它编辑态只读,该口径由 N4 卡片编辑框与
 * 组件用例 `unified-link-complete.dom.test.ts` 覆盖)。
 *   1 打 `[[` 出 8 条笔记候选(含高亮行);继续打字收窄;Enter -> `[[标题]]`、光标在末尾
 *   4 围栏代码块里打 `[[` 不弹候选
 *   5 Esc 只收面板不动正文;`]]` 出现即退出补全
 *   7 IME 组合态按 Enter 不采纳(合成 isComposing)
 * 收尾 夹具删净 + 库对账(notes/note_links 回基线 + integrity)。
 * 全部走 CDP 合成事件,不碰物理鼠标;夹具一律 `LINKN2测试` 前缀,自建自删。
 * 用法:LIFELOG_CDP_PORT=9222 node scripts/dev-links-accept-n2.mjs(先起 pnpm tauri dev)
 */
import { DatabaseSync } from 'node:sqlite';
import { CDP_PORT, ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { BOX, driver } from './unified-accept-lib.mjs';

const NS = 'LINKN2测试';
const TARGET = `${NS} 目标`;
const OTHER = `${NS} 购物清单`;
const DB_PATH = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';

const ro = (fn) => {
  const db = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
const counts = () =>
  ro((db) => {
    const n = (sql) => db.prepare(sql).get().n;
    return {
      notes: n('SELECT COUNT(*) n FROM notes'),
      noteLinks: n('SELECT COUNT(*) n FROM note_links'),
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    };
  });

const r = recorder();
const { record, finish } = r;
const fmt = (v) => JSON.stringify(v);

if (!(await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((x) => x.ok, () => false))) {
  console.log(`需要先起应用:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${CDP_PORT}" pnpm tauri dev`);
  process.exit(2);
}

const conn = await ensureMain();
const d = driver(conn.cdp);

/** 合成输入:经原型 setter + input 事件 + 光标落末尾(与组件用例同一手法,不碰物理键鼠) */
const setBox = (text) =>
  d.ev(`(() => { const el = document.querySelector('${BOX}');
    const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    s.call(el, ${JSON.stringify(text)}); el.setSelectionRange(${text.length}, ${text.length});
    el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`);
const rowLabels = async () => (await d.rows()).map((x) => x.label);
const dropdownOpen = () => d.ev(`!!document.querySelector('[data-testid="unified-dropdown"]')`);
const marks = () =>
  d.ev(`Array.from(document.querySelectorAll('[data-testid="unified-dropdown"] mark')).map((m) => m.textContent)`);
const boxState = () =>
  d.ev(`(() => { const el = document.querySelector('${BOX}');
    return { value: el.value, caret: el.selectionStart, len: el.value.length }; })()`);
/** 合成 Enter(isComposing:true):IME 上屏那一下 */
const imeEnter = () =>
  d.ev(`(() => { const el = document.querySelector('${BOX}');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    return el.value; })()`);

/** 回信息流:退编辑态 + 清条件 chip(否则新笔记可能不在 DOM 里) */
const gotoStream = async () => {
  await d.esc();
  await d.clearChips();
  await d.clearBox();
  await sleep(400);
};
let failure = null;
const stale = await d.call('query_notes', { conditions: { keyword: NS, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null }, offset: 0 });
for (const n of stale) await d.call('delete_note', { id: n.id });
await sleep(300);
const base = counts();
console.log(`INFO 基线=${fmt(base)}`);

try {
  await gotoStream();
  const target = await d.call('save_input_note', { content: TARGET });
  await d.call('save_input_note', { content: OTHER });
  const pool = await d.call('complete_notes');
  console.log(`INFO 夹具 id:目标=${target.id};池=${pool.length} 条`);

  // --- 读数 1:打 `[[` 出 8 条;打字收窄;Enter 采纳 ---
  await d.clearBox();
  await d.type('[[');
  const eight = await waitFor(async () => {
    const rows = await d.rows();
    return rows.length > 0 ? rows : null;
  }, 20, 250);
  const eightLabels = eight.map((x) => x.label);
  const selected = await d.ev(`document.querySelectorAll('[data-testid="unified-dropdown"] li[aria-selected="true"]').length`);
  const aria = await d.aria();
  await d.type('LINKN2');
  await waitFor(async () => ((await d.rows()).length === 2 ? true : null), 20, 250);
  const two = await rowLabels();
  await d.type('测试 目');
  const narrowed = await waitFor(async () => {
    const rows = await d.rows();
    return rows.length === 1 ? rows : null;
  }, 20, 250);
  const narrowedMarks = await marks();
  const beforeEnter = await boxState();
  await d.enter();
  const afterAccept = await waitFor(async () => {
    const s = await boxState();
    return s.value === `[[${TARGET}]]` ? s : null;
  }, 20, 250);
  record(
    '读数1 打 `[[` 出 8 条候选 -> 打字收窄 -> Enter 变 `[[标题]]` 且光标在末尾',
    eight.length === 8 &&
      selected === 1 &&
      aria.expanded === 'true' &&
      aria.controls === aria.listboxId &&
      aria.optExists === true &&
      two.length === 2 &&
      two.every((l) => l.startsWith(NS)) &&
      narrowed !== null &&
      narrowed.length === 1 &&
      narrowed[0].label === TARGET &&
      narrowedMarks.join('').includes('目') &&
      beforeEnter.value === '[[LINKN2测试 目' &&
      afterAccept?.value === `[[${TARGET}]]` &&
      afterAccept?.caret === afterAccept?.len &&
      (await dropdownOpen()) === false,
    `打[[条数=${eight.length} 首条=${fmt(eightLabels.slice(0, 3))} 高亮行=${selected} aria=${fmt({ expanded: aria.expanded, controls: aria.controls, ok: aria.optExists })} LINKN2=${fmt(two)} 收窄=${fmt(narrowed?.map((x) => x.label))} mark=${fmt(narrowedMarks)} 采纳后=${fmt(afterAccept)}`
  );

  // --- 读数 4:围栏代码块里打 `[[` 不弹 ---
  await setBox('```\n[[LINKN2');
  await sleep(500);
  const fencedOpen = await dropdownOpen();
  record('读数4 围栏代码块里打 `[[` 不弹候选', fencedOpen === false, `下拉=${fencedOpen}(期望 false)`);

  // --- 读数 5:Esc 只收面板不动正文;`]]` 出现即退出 ---
  await setBox('[[LINKN2');
  await waitFor(() => dropdownOpen(), 20, 250);
  await d.esc();
  const afterEsc = await boxState();
  const escOpen = await dropdownOpen();
  await setBox(`[[${TARGET}]]`);
  await sleep(500);
  const closedOpen = await dropdownOpen();
  record(
    '读数5 Esc 只关下拉不动正文;`]]` 出现即退出补全',
    escOpen === false && afterEsc.value === '[[LINKN2' && closedOpen === false,
    `Esc后 下拉=${escOpen} 正文=${fmt(afterEsc.value)};闭合后 下拉=${closedOpen}`
  );

  // --- 读数 7:IME 组合态按 Enter 不采纳 ---
  await setBox('[[LINKN2测试 目');
  await waitFor(() => dropdownOpen(), 20, 250);
  const imeValue = await imeEnter();
  await sleep(400);
  const imeOpen = await dropdownOpen();
  await d.enter();
  const afterImeAccept = await waitFor(async () => {
    const s = await boxState();
    return s.value === `[[${TARGET}]]` ? s : null;
  }, 20, 250);
  record(
    '读数7 IME 组合态按 Enter 不采纳(面板与正文不动),组合结束后照常采纳',
    imeValue === '[[LINKN2测试 目' && imeOpen === true && afterImeAccept?.value === `[[${TARGET}]]`,
    `组合中值=${fmt(imeValue)} 下拉=${imeOpen} 组合后采纳=${fmt(afterImeAccept?.value)}`
  );

  // 清理输入框(留下的已闭合链接不应被保存)
  await d.clearBox();
  await sleep(300);
} catch (e) {
  failure = e;
} finally {
  const left = await d.call('query_notes', { conditions: { keyword: NS, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null }, offset: 0 });
  for (const n of left) await d.call('delete_note', { id: n.id });
  const gone = await waitFor(async () => {
    const l = await d.call('query_notes', { conditions: { keyword: NS, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null }, offset: 0 });
    return l.length === 0 ? true : null;
  }, 12, 250);
  const after = counts();
  const diff = ['notes', 'noteLinks'].filter((k) => after[k] !== base[k]);
  record(
    '收尾 夹具删净 + 库对账(回基线 + integrity)',
    gone === true && diff.length === 0 && after.integrity === 'ok',
    `删除 ${left.length} 条夹具;不一致=${fmt(diff.map((k) => `${k} ${base[k]}->${after[k]}`))} 收尾=${fmt(after)}`
  );
}

if (failure) record('异常中断', false, String(failure?.message ?? failure));
finish();
conn.close();
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
