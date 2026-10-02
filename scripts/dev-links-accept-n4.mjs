#!/usr/bin/env node
/** `[[` 补全 N4(卡片就地编辑源码框)真机读数:2 打 `[[` 出候选/收窄/Enter 采纳;4 围栏不弹;
 *  5 Esc 先关下拉再退出编辑;6 候选不含正在编辑的自己;7 IME 组合中不采纳。
 *  全走 CDP 合成事件,不碰物理鼠标;夹具 `LINKN4测试*` 自建自删,收尾回基线对账。
 *  用法:先 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" pnpm tauri dev`,
 *  再 `node scripts/dev-links-accept-n4.mjs`。 */
import { DatabaseSync } from 'node:sqlite';
import { CDP_PORT, ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { driver } from './unified-accept-lib.mjs';

const NS = 'LINKN4测试';
const TARGET = `${NS} 目标`;
const OTHER = `${NS} 购物清单`;
const DB_PATH = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
const PANEL = '[data-testid="edit-panel"]';
const CBOX = `${PANEL} textarea`;
const SUG = '[data-testid="edit-link-suggest"]';
const OPT = `${SUG} [role="option"]`;
const KW = { tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null };

const counts = () => {
  const db = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
  const n = (sql) => db.prepare(sql).get().n;
  try {
    return { notes: n('SELECT COUNT(*) n FROM notes'), noteLinks: n('SELECT COUNT(*) n FROM note_links'),
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check };
  } finally {
    db.close();
  }
};

const r = recorder();
const { record, finish } = r;
const fmt = (v) => JSON.stringify(v);

if (!(await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((x) => x.ok, () => false))) {
  console.log(`需要先起应用:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${CDP_PORT}" pnpm tauri dev`);
  process.exit(2);
}
const conn = await ensureMain();
const d = driver(conn.cdp);

/** 卡片源码框的动作件(与统一输入框 driver 同手法:原型 setter 打字 + DOM 读数) */
const card = {
  panel: () => d.ev(`!!document.querySelector('${PANEL}')`),
  focus: () => d.ev(`(() => { const el = document.querySelector('${CBOX}'); if (!el) return false; el.focus(); return true; })()`),
  setValue: (text) => d.ev(`(() => { const el = document.querySelector('${CBOX}');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(text)});
    el.setSelectionRange(${text.length}, ${text.length}); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`),
  state: () => d.ev(`(() => { const el = document.querySelector('${CBOX}'); if (!el) return null;
    return { value: el.value, caret: el.selectionStart, len: el.value.length }; })()`),
  open: () => d.ev(`!!document.querySelector('${SUG}')`),
  empty: () => d.ev(`document.querySelector('${SUG} p')?.textContent ?? null`),
  marks: () => d.ev(`Array.from(document.querySelectorAll('${SUG} mark')).map((m) => m.textContent)`),
  rows: () => d.ev(`Array.from(document.querySelectorAll('${OPT}')).map((li) => ({ label: li.textContent.trim(),
    selected: li.getAttribute('aria-selected') }))`),
  aria: () => d.ev(`(() => { const el = document.querySelector('${CBOX}'), opt = el?.getAttribute('aria-activedescendant');
    return { controls: el?.getAttribute('aria-controls') ?? null, listboxId: document.querySelector('${SUG}')?.id ?? null,
      optExists: opt ? !!document.getElementById(opt) : false }; })()`),
};
/** 进编辑:点笔记正文(pointerdown + click,与真实鼠标同序) */
const enterEdit = (id) => d.ev(`(() => { const el = document.querySelector('[data-note-body="${id}"]'); if (!el) return { ok: false };
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 6, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return { ok: true }; })()`);
const imeEnter = () => d.ev(`(() => { const el = document.querySelector('${CBOX}');
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })); return el.value; })()`);
const notesByKeyword = (kw) => d.call('query_notes', { conditions: { ...KW, keyword: kw }, offset: 0 });
const gotoStream = async () => {
  await d.esc();
  await d.clearChips();
  await d.clearBox();
  await sleep(400);
};

let failure = null;
for (const n of await notesByKeyword(NS)) await d.call('delete_note', { id: n.id });
await sleep(300);
const base = counts();
console.log(`INFO 基线=${fmt(base)}`);

try {
  await gotoStream();
  const target = await d.call('save_input_note', { content: TARGET });
  await d.call('save_input_note', { content: OTHER });
  await sleep(600);
  console.log(`INFO 夹具 id:目标=${target.id};池=${(await d.call('complete_notes')).length} 条`);

  await enterEdit(target.id);
  await waitFor(card.panel, 20, 250);
  const editing = await card.panel();

  // --- 读数 2:打 `[[` 出 8 条;收窄;Enter 采纳 ---
  await card.focus();
  await card.setValue('正文[[');
  const eight = await waitFor(async () => {
    const rows = await card.rows();
    return rows.length === 8 ? rows : null;
  }, 20, 250);
  const aria = await card.aria();
  await card.setValue('正文[[LINKN4测试 购');
  const one = await waitFor(async () => {
    const rows = await card.rows();
    return rows.length === 1 ? rows : null;
  }, 20, 250);
  const marks = await card.marks();
  await card.focus();
  await d.enter();
  const accepted = await waitFor(async () => {
    const s = await card.state();
    return s && s.value === `正文[[${OTHER}]]` ? s : null;
  }, 20, 250);
  const hi = eight?.filter((x) => x.selected === 'true').length;
  record(
    '读数2 源码框打 `[[` 出 8 条候选 -> 收窄 -> Enter 变 `[[标题]]` 且光标在末尾',
    editing === true && eight !== null && hi === 1 && aria.controls === aria.listboxId && aria.optExists === true &&
      one !== null && one[0].label === OTHER && marks.join('').includes('购') && accepted?.caret === accepted?.len &&
      (await card.open()) === false,
    `编辑中=${editing} 打[[条数=${eight?.length} 高亮行=${hi} aria=${fmt({ controls: aria.controls, ok: aria.optExists })} 收窄=${fmt(one?.map((x) => x.label))} mark=${fmt(marks)} 采纳后=${fmt(accepted)}`
  );

  // --- 读数 6:候选不含正在编辑的这条自己 ---
  await card.focus();
  await card.setValue(`正文[[${TARGET}`);
  await waitFor(card.open, 20, 250);
  await sleep(400);
  const selfRows = await card.rows();
  const emptyText = await card.empty();
  record(
    '读数6 候选不含正在编辑的这条自己(打自己的标题 -> 空态)',
    selfRows.length === 0 && (emptyText ?? '').includes('没有匹配的笔记'),
    `行数=${selfRows.length} 空态=${fmt(emptyText)}`
  );

  // --- 读数 4:围栏代码块里打 `[[` 不弹 ---
  await card.focus();
  await card.setValue('```\n[[LINKN4');
  await sleep(500);
  const fencedOpen = await card.open();
  record('读数4 围栏代码块里打 `[[` 不弹候选', fencedOpen === false, `下拉=${fencedOpen}(期望 false)`);

  // --- 读数 5:Esc 两级(用未在别处按过 Esc 的新查询,避开「同一正文不再重现」的 mutedOn) ---
  await card.focus();
  await card.setValue('正文[[');
  await waitFor(card.open, 20, 250);
  await d.esc();
  await sleep(400);
  const esc1 = { open: await card.open(), panel: await card.panel(), state: await card.state() };
  await d.esc();
  await sleep(500);
  const esc2 = { panel: await card.panel() };
  record(
    '读数5 Esc 先关下拉(不退出编辑、正文不动),再 Esc 才退出编辑',
    esc1.open === false && esc1.panel === true && esc1.state?.value === '正文[[' && esc2.panel === false,
    `第一下 下拉=${esc1.open} 编辑中=${esc1.panel} 正文=${fmt(esc1.state?.value)};第二下 编辑中=${esc2.panel}`
  );

  // --- 读数 7:IME 组合态按 Enter 不采纳 ---
  await enterEdit(target.id);
  await waitFor(card.panel, 20, 250);
  await card.focus();
  await card.setValue('正文[[LINKN4测试 购');
  await waitFor(card.open, 20, 250);
  const imeValue = await imeEnter();
  await sleep(400);
  const imeOpen = await card.open();
  await card.focus();
  await d.enter();
  const afterIme = await waitFor(async () => {
    const s = await card.state();
    return s && s.value === `正文[[${OTHER}]]` ? s : null;
  }, 20, 250);
  record(
    '读数7 IME 组合态按 Enter 不采纳(面板与正文不动),组合结束后照常采纳',
    imeValue === '正文[[LINKN4测试 购' && imeOpen === true && afterIme?.value === `正文[[${OTHER}]]`,
    `组合中值=${fmt(imeValue)} 下拉=${imeOpen} 组合后采纳=${fmt(afterIme?.value)}`
  );

  await d.esc();
  await d.esc();
  await sleep(400);
} catch (e) {
  failure = e;
} finally {
  for (const n of await notesByKeyword(NS)) await d.call('delete_note', { id: n.id });
  const gone = await waitFor(async () => ((await notesByKeyword(NS)).length === 0 ? true : null), 12, 250);
  const after = counts();
  const diff = ['notes', 'noteLinks'].filter((k) => after[k] !== base[k]);
  record('收尾 夹具删净 + 库对账(回基线 + integrity)',
    gone === true && diff.length === 0 && after.integrity === 'ok',
    `不一致=${fmt(diff.map((k) => `${k} ${base[k]}->${after[k]}`))} 收尾=${fmt(after)}`);
}

if (failure) record('异常中断', false, String(failure?.message ?? failure));
finish();
conn.close();
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
