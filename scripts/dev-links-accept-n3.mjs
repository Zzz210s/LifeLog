#!/usr/bin/env node
/**
 * `[[` 自动补全 N3(输入栏接线)的真机读数(设计 2026-10-01-link-autocomplete-design.md 的读数 3,
 * 以及同款的 4/5/7):
 *   3 输入栏打 `[[` 出笔记候选(含高亮)-> 打字收窄 -> Enter -> 输入框内容 = `[[标题]]`、光标在末尾
 *   4 围栏代码块里打 `[[` 不弹候选
 *   5 Esc 只关下拉(输入栏不隐藏、正文不动);`]]` 出现即退出补全
 *   7 IME 组合态按 Enter 不采纳(合成 isComposing)
 *   遗留2 主窗改笔记首行 -> 输入栏候选池随之失效(跨窗 note-created,不必重进会话)
 * 收尾 夹具删净 + 库对账(notes/note_links 回基线 + integrity),输入框清空。
 * 全部走 CDP 合成事件,不碰物理鼠标;夹具一律 `LINKN3测试` 前缀,自建自删。
 * 用法:LIFELOG_CDP_PORT=9222 node scripts/dev-links-accept-n3.mjs(先起 pnpm tauri dev)
 */
import { spawnSync } from 'node:child_process';
import { bindMain, ensureMain, open, recorder, waitFor } from './cdp-lib.mjs';
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

const NS = 'LINKN3测试';
const TARGET = `${NS} 目标`;
const OTHER = `${NS} 购物清单`;
const SEL = 'textarea[aria-label="输入栏内容"]';
const LIST = '[data-testid="link-suggest"]';
const ROW = 'button[role="option"]';

const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const pid = Number(sh('powershell', ['-NoProfile', '-Command', "(Get-Process | Where-Object { $_.ProcessName -match '^lifelog$' } | Select-Object -First 1).Id"]).stdout.trim());
/** 输入栏窗口的 OS 可见性(CDP 的 visibilityState 对已隐藏窗口不可靠,故走 Win32 IsWindowVisible) */
const inputVisible = () => {
  const list = JSON.parse(sh('python', ['scripts/win-probe.py', 'list', String(pid)]).stdout || '[]');
  return !!list.find((w) => w.cls === 'Tauri Window' && w.title === '输入栏')?.visible;
};

await requireApp();
const main = await ensureMain();
const { call } = bindMain(main.cdp);
await call('show_input_bar');
const input = await waitFor(() => open('input').catch(() => null), 20, 250);
if (!input) throw new Error('输入栏页面未出现(检查 input.html 是否已创建)');
const cdp = input.cdp;
const suggest = linkSuggest(cdp, { list: LIST, row: ROW });

const r = recorder();
const { record, finish } = r;
let failure = null;

await purgeFixtures(call, NS);
await sleep(300);
const base = counts();
console.log(`INFO 基线=${fmt(base)}`);

try {
  const { other, pool } = await seedFixtures(call, TARGET, OTHER);
  await setText(cdp, SEL, '');
  console.log(`INFO 夹具=${fmt([TARGET, OTHER])};池=${pool.length} 条`);

  // --- 读数 3:打 `[[` 出候选 -> 收窄 -> Enter ---
  await setText(cdp, SEL, '[[');
  const eight = await waitFor(async () => {
    const labels = await suggest.labels();
    return labels.length > 0 ? labels : null;
  }, 20, 250);
  const selected = await suggest.selected();
  await setText(cdp, SEL, '[[LINKN3');
  const two = await waitFor(async () => {
    const labels = await suggest.labels();
    return labels.length === 2 ? labels : null;
  }, 20, 250);
  await setText(cdp, SEL, '[[LINKN3测试 目');
  const narrowed = await waitFor(async () => {
    const labels = await suggest.labels();
    return labels.length === 1 ? labels : null;
  }, 20, 250);
  const narrowedMarks = await suggest.marks();
  const beforeEnter = await boxState(cdp, SEL);
  await keyOn(cdp, SEL, 'Enter');
  const afterAccept = await waitFor(async () => {
    const s = await boxState(cdp, SEL);
    return s.value === `[[${TARGET}]]` ? s : null;
  }, 20, 250);
  record(
    '读数3 输入栏打 `[[` 出候选 -> 收窄 -> Enter 变 `[[标题]]` 且光标在末尾',
    eight !== null && eight.length === 8 && selected === 1 && two !== null &&
      two.every((l) => l.startsWith(NS)) && narrowed?.[0] === TARGET &&
      narrowedMarks.join('').includes('目') && beforeEnter.value === '[[LINKN3测试 目' &&
      afterAccept?.value === `[[${TARGET}]]` && afterAccept?.caret === afterAccept?.len &&
      (await suggest.open()) === false,
    `打[[条数=${eight?.length} 首条=${fmt(eight?.slice(0, 3))} 高亮行=${selected} LINKN3=${fmt(two)} 收窄=${fmt(narrowed)} mark=${fmt(narrowedMarks)} 采纳后=${fmt(afterAccept)}`,
  );

  // --- 遗留2:主窗改笔记首行 -> 输入栏候选池随之失效 ---
  await setText(cdp, SEL, '[[购物');
  const stale = await waitFor(async () => {
    const labels = await suggest.labels();
    return labels.includes(OTHER) ? labels : null;
  }, 20, 250);
  const NEW = `${NS} 改名后`;
  await call('update_note', { id: other.id, content: NEW }); // 主窗口径的写库(会广播 note-created 给输入栏)
  await setText(cdp, SEL, `[[${NS} 改名`);
  const refreshed = await waitFor(async () => {
    const labels = await suggest.labels();
    return labels.includes(NEW) ? labels : null;
  }, 20, 250);
  record(
    '遗留2 主窗改笔记首行 -> 输入栏候选池随之失效(跨窗 note-created)',
    stale !== null && refreshed !== null,
    `改名前命中=${fmt(stale)};改名后命中=${fmt(refreshed)}`,
  );

  // --- 读数 4:围栏代码块里打 `[[` 不弹 ---
  await setText(cdp, SEL, '```\n[[LINKN3');
  await sleep(500);
  const fencedOpen = await suggest.open();
  record('读数4 围栏代码块里打 `[[` 不弹候选', fencedOpen === false, `下拉=${fencedOpen}(期望 false)`);

  // --- 读数 5:Esc 只关下拉(输入栏不隐藏、正文不动);`]]` 出现即退出 ---
  await setText(cdp, SEL, '[[LINKN3');
  await waitFor(() => suggest.open(), 20, 250);
  await keyOn(cdp, SEL, 'Escape');
  await sleep(400);
  const afterEsc = await boxState(cdp, SEL);
  const escOpen = await suggest.open();
  const escVisible = inputVisible();
  await setText(cdp, SEL, `[[${TARGET}]]`);
  await sleep(400);
  const closedOpen = await suggest.open();
  record(
    '读数5 Esc 只关下拉(输入栏不隐藏、正文不动);`]]` 出现即退出补全',
    escOpen === false && escVisible === true && afterEsc.value === '[[LINKN3' && closedOpen === false,
    `Esc后 下拉=${escOpen} 输入栏可见=${escVisible} 正文=${fmt(afterEsc.value)};闭合后 下拉=${closedOpen}`,
  );

  // --- 读数 7:IME 组合态按 Enter 不采纳 ---
  await setText(cdp, SEL, '[[LINKN3测试 目');
  await waitFor(() => suggest.open(), 20, 250);
  const imeValue = await keyOn(cdp, SEL, 'Enter', ', isComposing: true');
  await sleep(400);
  const imeOpen = await suggest.open();
  await keyOn(cdp, SEL, 'Enter');
  const afterIme = await waitFor(async () => {
    const s = await boxState(cdp, SEL);
    return s.value === `[[${TARGET}]]` ? s : null;
  }, 20, 250);
  record(
    '读数7 IME 组合态按 Enter 不采纳,组合结束后照常采纳',
    imeValue === '[[LINKN3测试 目' && imeOpen === true && afterIme?.value === `[[${TARGET}]]`,
    `组合中值=${fmt(imeValue)} 下拉=${imeOpen} 组合后采纳=${fmt(afterIme?.value)}`,
  );

  await setText(cdp, SEL, ''); // 清空输入框:已闭合的链接不应被保存
  await sleep(300);
} catch (e) {
  failure = e;
} finally {
  await settleFixtures(call, r, NS, base);
}

if (failure) record('异常中断', false, String(failure?.message ?? failure));
finish();
main.close();
input.close();
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
