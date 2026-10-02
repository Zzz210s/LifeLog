#!/usr/bin/env node
/**
 * `[[` 自动补全 N2(统一输入框接线)的真机读数(设计 2026-10-01-link-autocomplete-design.md 的 1/4/5/7;
 * 读数 6「候选不含正在编辑的自己」在统一输入框上不适用 —— 它编辑态只读,该口径由 N4 卡片编辑框与
 * 组件用例 `unified-link-complete.dom.test.ts` 覆盖)。
 *   1 打 `[[` 出 8 条笔记候选(含高亮行);继续打字收窄;Enter -> `[[标题]]`、光标在末尾
 *   4 围栏代码块里打 `[[` 不弹候选
 *   5 Esc 只收面板不动正文;`]]` 出现即退出补全
 *   7 IME 组合态按 Enter 不采纳(合成 isComposing)
 *   遗留1 空查询按 MRU 排序 + 采纳后进 MRU 并落盘(读库 ui.mru.notes 对账)
 * 收尾 夹具删净 + 库对账(notes/note_links 回基线 + integrity)。
 * 全部走 CDP 合成事件,不碰物理鼠标;夹具一律 `LINKN2测试` 前缀,自建自删。
 * 用法:LIFELOG_CDP_PORT=9222 node scripts/dev-links-accept-n2.mjs(先起 pnpm tauri dev)
 */
import { ensureMain, recorder } from './cdp-lib.mjs';
import { BOX, driver } from './unified-accept-lib.mjs';
import {
  boxState,
  counts,
  fmt,
  keyOn,
  linkSuggest,
  purgeFixtures,
  readMruNotes,
  requireApp,
  seedFixtures,
  setText,
  settleFixtures,
  sleep,
  waitFor,
} from './link-accept-lib.mjs';

const NS = 'LINKN2测试';
const TARGET = `${NS} 目标`;
const OTHER = `${NS} 购物清单`;
const LIST = '[data-testid="unified-dropdown"]';
const ROW = 'li[role="option"]';

await requireApp();
const conn = await ensureMain();
const cdp = conn.cdp;
const d = driver(cdp);
const suggest = linkSuggest(cdp, { list: LIST, row: ROW });

/** 合成 Enter(isComposing:true):IME 上屏那一下 */
const imeEnter = () => keyOn(cdp, BOX, 'Enter', ', isComposing: true');
/** 回信息流:退编辑态 + 清条件 chip(否则新笔记可能不在 DOM 里) */
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
  const { target, pool } = await seedFixtures(d.call, TARGET, OTHER);
  console.log(`INFO 夹具 id:目标=${target.id};池=${pool.length} 条`);

  // --- 读数 1:打 `[[` 出 8 条;打字收窄;Enter 采纳 ---
  await d.clearBox();
  await d.type('[[');
  const eight = await waitFor(async () => {
    const labels = await suggest.labels();
    return labels.length > 0 ? labels : null;
  }, 20, 250);
  const selected = await suggest.selected();
  const aria = await d.aria();
  await d.type('LINKN2');
  await waitFor(async () => ((await suggest.labels()).length === 2 ? true : null), 20, 250);
  const two = await suggest.labels();
  await d.type('测试 目');
  const narrowed = await waitFor(async () => {
    const labels = await suggest.labels();
    return labels.length === 1 ? labels : null;
  }, 20, 250);
  const narrowedMarks = await suggest.marks();
  const beforeEnter = await boxState(cdp, BOX);
  await d.enter();
  const afterAccept = await waitFor(async () => {
    const s = await boxState(cdp, BOX);
    return s.value === `[[${TARGET}]]` ? s : null;
  }, 20, 250);
  record(
    '读数1 打 `[[` 出 8 条候选 -> 打字收窄 -> Enter 变 `[[标题]]` 且光标在末尾',
    eight?.length === 8 &&
      selected === 1 &&
      aria.expanded === 'true' &&
      aria.controls === aria.listboxId &&
      aria.optExists === true &&
      two.length === 2 &&
      two.every((l) => l.startsWith(NS)) &&
      narrowed?.length === 1 &&
      narrowed[0] === TARGET &&
      narrowedMarks.join('').includes('目') &&
      beforeEnter.value === '[[LINKN2测试 目' &&
      afterAccept?.value === `[[${TARGET}]]` &&
      afterAccept?.caret === afterAccept?.len &&
      (await suggest.open()) === false,
    `打[[条数=${eight?.length} 首条=${fmt(eight?.slice(0, 3))} 高亮行=${selected} aria=${fmt({ expanded: aria.expanded, controls: aria.controls, ok: aria.optExists })} LINKN2=${fmt(two)} 收窄=${fmt(narrowed)} mark=${fmt(narrowedMarks)} 采纳后=${fmt(afterAccept)}`,
  );

  // --- 遗留1:空查询按 MRU 排序 + 采纳进 MRU 并落盘 ---
  const byId = new Map(pool.map((p) => [String(p.id), p.title]));
  const top = readMruNotes()
    .slice()
    .sort((a, b) => b.count - a.count)
    .find((e) => byId.has(e.id));
  const topTitle = top ? byId.get(top.id) : null;
  await setText(cdp, BOX, '');
  await sleep(300);
  await setText(cdp, BOX, '[[');
  const mruFirst = await waitFor(async () => {
    const labels = await suggest.labels();
    return labels.length > 0 ? labels : null;
  }, 20, 250);
  await d.enter(); // 采纳第一行(= 库 MRU 最高那条)
  await sleep(2000); // 等空闲落盘(MRU_IDLE_SAVE_MS = 1500)
  const topAfter = readMruNotes().find((e) => e.id === top?.id);
  record(
    '遗留1 空查询 MRU 优先 + 采纳后进 MRU 并落盘',
    topTitle !== null && mruFirst?.[0] === topTitle && topAfter?.count === (top?.count ?? 0) + 1,
    `库MRU最高=${fmt(top)} 其标题=${fmt(topTitle)};打[[首条=${fmt(mruFirst?.[0])};采纳后该条=${fmt(topAfter)}`,
  );
  await d.clearBox();

  // --- 读数 4:围栏代码块里打 `[[` 不弹 ---
  await setText(cdp, BOX, '```\n[[LINKN2');
  await sleep(500);
  const fencedOpen = await suggest.open();
  record('读数4 围栏代码块里打 `[[` 不弹候选', fencedOpen === false, `下拉=${fencedOpen}(期望 false)`);

  // --- 读数 5:Esc 只收面板不动正文;`]]` 出现即退出 ---
  await setText(cdp, BOX, '[[LINKN2');
  await waitFor(() => suggest.open(), 20, 250);
  await d.esc();
  const afterEsc = await boxState(cdp, BOX);
  const escOpen = await suggest.open();
  await setText(cdp, BOX, `[[${TARGET}]]`);
  await sleep(500);
  const closedOpen = await suggest.open();
  record(
    '读数5 Esc 只关下拉不动正文;`]]` 出现即退出补全',
    escOpen === false && afterEsc.value === '[[LINKN2' && closedOpen === false,
    `Esc后 下拉=${escOpen} 正文=${fmt(afterEsc.value)};闭合后 下拉=${closedOpen}`,
  );

  // --- 读数 7:IME 组合态按 Enter 不采纳 ---
  await setText(cdp, BOX, '[[LINKN2测试 目');
  await waitFor(() => suggest.open(), 20, 250);
  const imeValue = await imeEnter();
  await sleep(400);
  const imeOpen = await suggest.open();
  await d.enter();
  const afterImeAccept = await waitFor(async () => {
    const s = await boxState(cdp, BOX);
    return s.value === `[[${TARGET}]]` ? s : null;
  }, 20, 250);
  record(
    '读数7 IME 组合态按 Enter 不采纳(面板与正文不动),组合结束后照常采纳',
    imeValue === '[[LINKN2测试 目' && imeOpen === true && afterImeAccept?.value === `[[${TARGET}]]`,
    `组合中值=${fmt(imeValue)} 下拉=${imeOpen} 组合后采纳=${fmt(afterImeAccept?.value)}`,
  );

  await d.clearBox(); // 清空输入框(留下的已闭合链接不应被保存)
  await sleep(300);
} catch (e) {
  failure = e;
} finally {
  await settleFixtures(d.call, r, NS, base);
}

if (failure) record('异常中断', false, String(failure?.message ?? failure));
finish();
conn.close();
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
