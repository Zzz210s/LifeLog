#!/usr/bin/env node
/** `[[` 补全 N4(卡片就地编辑源码框)真机读数:2 打 `[[` 出候选/收窄/Enter 采纳;4 围栏不弹;
 *  5 Esc 先关下拉再退出编辑;6 候选不含正在编辑的自己;7 IME 组合中不采纳。
 *  全走 CDP 合成事件,不碰物理鼠标;夹具 `LINKN4测试*` 自建自删,收尾回基线对账。
 *  用法:先 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" pnpm tauri dev`,
 *  再 `node scripts/dev-links-accept-n4.mjs`。 */
import { ensureMain, recorder, waitFor } from './cdp-lib.mjs';
import { driver } from './unified-accept-lib.mjs';
import {
  boxState,
  counts,
  fmt,
  keyOn,
  linkSuggest,
  purgeFixtures,
  requireApp,
  seedFixtures,
  setText,
  settleFixtures,
  sleep,
} from './link-accept-lib.mjs';

const NS = 'LINKN4测试';
const TARGET = `${NS} 目标`;
const OTHER = `${NS} 购物清单`;
const PANEL = '[data-testid="edit-panel"]';
const CBOX = `${PANEL} textarea`;
const SUG = '[data-testid="edit-link-suggest"]';

await requireApp();
const conn = await ensureMain();
const cdp = conn.cdp;
const d = driver(cdp);
const suggest = linkSuggest(cdp, { list: SUG, row: '[role="option"]' });

/** 卡片源码框特有的两件读数:aria 绑定 + 空态文案(setText/boxState/suggest 走共用件) */
const card = {
  panel: () => cdp.eval(`!!document.querySelector('${PANEL}')`),
  focus: () => cdp.eval(`(() => { const el = document.querySelector('${CBOX}'); if (!el) return false; el.focus(); return true; })()`),
  empty: () => cdp.eval(`document.querySelector('${SUG} p')?.textContent ?? null`),
  aria: () =>
    cdp.eval(`(() => { const el = document.querySelector('${CBOX}'), opt = el?.getAttribute('aria-activedescendant');
      return { controls: el?.getAttribute('aria-controls') ?? null, listboxId: document.querySelector('${SUG}')?.id ?? null,
        optExists: opt ? !!document.getElementById(opt) : false }; })()`),
};
/** 进编辑:点笔记正文(pointerdown + click,与真实鼠标同序) */
const enterEdit = (id) =>
  cdp.eval(`(() => { const el = document.querySelector('[data-note-body="${id}"]'); if (!el) return { ok: false };
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 6, pointerId: 1, isPrimary: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return { ok: true }; })()`);
const imeEnter = () => keyOn(cdp, CBOX, 'Enter', ', isComposing: true');
const gotoStream = async () => {
  await d.esc();
  await d.clearChips();
  await d.clearBox();
  await sleep(400);
};

const r = recorder();
const { record, finish } = r;
let failure = null;

await purgeFixtures(d.call, NS);
await sleep(300);
const base = counts();
console.log(`INFO 基线=${fmt(base)}`);

try {
  await gotoStream();
  const { target } = await seedFixtures(d.call, TARGET, OTHER);
  await sleep(600);
  console.log(`INFO 夹具 id:目标=${target.id};池=${(await d.call('complete_notes')).length} 条`);

  await enterEdit(target.id);
  await waitFor(card.panel, 20, 250);
  const editing = await card.panel();

  // --- 读数 2:打 `[[` 出 8 条;收窄;Enter 采纳 ---
  await card.focus();
  await setText(cdp, CBOX, '正文[[');
  const eight = await waitFor(async () => {
    const labels = await suggest.labels();
    return labels.length === 8 ? labels : null;
  }, 20, 250);
  const hi = await suggest.selected(); // 采纳前读高亮行(采纳后下拉已关)
  const aria = await card.aria();
  await setText(cdp, CBOX, '正文[[LINKN4测试 购');
  const one = await waitFor(async () => {
    const labels = await suggest.labels();
    return labels.length === 1 ? labels : null;
  }, 20, 250);
  const marks = await suggest.marks();
  await card.focus();
  await d.enter();
  const accepted = await waitFor(async () => {
    const s = await boxState(cdp, CBOX);
    return s && s.value === `正文[[${OTHER}]]` ? s : null;
  }, 20, 250);
  record(
    '读数2 源码框打 `[[` 出 8 条候选 -> 收窄 -> Enter 变 `[[标题]]` 且光标在末尾',
    editing === true && eight !== null && hi === 1 && aria.controls === aria.listboxId && aria.optExists === true &&
      one?.[0] === OTHER && marks.join('').includes('购') && accepted?.caret === accepted?.len &&
      (await suggest.open()) === false,
    `编辑中=${editing} 打[[条数=${eight?.length} 高亮行=${hi} aria=${fmt({ controls: aria.controls, ok: aria.optExists })} 收窄=${fmt(one)} mark=${fmt(marks)} 采纳后=${fmt(accepted)}`,
  );

  // --- 读数 6:候选不含正在编辑的这条自己 ---
  await card.focus();
  await setText(cdp, CBOX, `正文[[${TARGET}`);
  await waitFor(suggest.open, 20, 250);
  await sleep(400);
  const selfRows = await suggest.labels();
  const emptyText = await card.empty();
  record(
    '读数6 候选不含正在编辑的这条自己(打自己的标题 -> 空态)',
    selfRows.length === 0 && (emptyText ?? '').includes('没有匹配的条目'),
    `行数=${selfRows.length} 空态=${fmt(emptyText)}`,
  );

  // --- 读数 4:围栏代码块里打 `[[` 不弹 ---
  await card.focus();
  await setText(cdp, CBOX, '```\n[[LINKN4');
  await sleep(500);
  const fencedOpen = await suggest.open();
  record('读数4 围栏代码块里打 `[[` 不弹候选', fencedOpen === false, `下拉=${fencedOpen}(期望 false)`);

  // --- 读数 5:Esc 两级(用未在别处按过 Esc 的新查询,避开「同一正文不再重现」的 mutedOn) ---
  await card.focus();
  await setText(cdp, CBOX, '正文[[');
  await waitFor(suggest.open, 20, 250);
  await d.esc();
  await sleep(400);
  const esc1 = { open: await suggest.open(), panel: await card.panel(), state: await boxState(cdp, CBOX) };
  await d.esc();
  await sleep(500);
  const esc2 = { panel: await card.panel() };
  record(
    '读数5 Esc 先关下拉(不退出编辑、正文不动),再 Esc 才退出编辑',
    esc1.open === false && esc1.panel === true && esc1.state?.value === '正文[[' && esc2.panel === false,
    `第一下 下拉=${esc1.open} 编辑中=${esc1.panel} 正文=${fmt(esc1.state?.value)};第二下 编辑中=${esc2.panel}`,
  );

  // --- 读数 7:IME 组合态按 Enter 不采纳 ---
  await enterEdit(target.id);
  await waitFor(card.panel, 20, 250);
  await card.focus();
  await setText(cdp, CBOX, '正文[[LINKN4测试 购');
  await waitFor(suggest.open, 20, 250);
  const imeValue = await imeEnter();
  await sleep(400);
  const imeOpen = await suggest.open();
  await card.focus();
  await d.enter();
  const afterIme = await waitFor(async () => {
    const s = await boxState(cdp, CBOX);
    return s && s.value === `正文[[${OTHER}]]` ? s : null;
  }, 20, 250);
  record(
    '读数7 IME 组合态按 Enter 不采纳(面板与正文不动),组合结束后照常采纳',
    imeValue === '正文[[LINKN4测试 购' && imeOpen === true && afterIme?.value === `正文[[${OTHER}]]`,
    `组合中值=${fmt(imeValue)} 下拉=${imeOpen} 组合后采纳=${fmt(afterIme?.value)}`,
  );

  await d.esc();
  await d.esc();
  await sleep(400);
} catch (e) {
  failure = e;
} finally {
  await settleFixtures(d.call, r, NS, base);
}

if (failure) record('异常中断', false, String(failure?.message ?? failure));
finish();
conn.close();
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
