#!/usr/bin/env node
/**
 * `[[` 自动补全 N3(输入栏接线)的真机读数(设计 2026-10-01-link-autocomplete-design.md 的读数 3,
 * 以及同款的 4/5/7):
 *   3 输入栏打 `[[` 出笔记候选(含高亮)-> 打字收窄 -> Enter -> 输入框内容 = `[[标题]]`、光标在末尾
 *   4 围栏代码块里打 `[[` 不弹候选
 *   5 Esc 只关下拉(输入栏不隐藏、正文不动);`]]` 出现即退出补全
 *   7 IME 组合态按 Enter 不采纳(合成 isComposing)
 * 收尾 夹具删净 + 库对账(notes/note_links 回基线 + integrity),输入框清空。
 * 全部走 CDP 合成事件,不碰物理鼠标;夹具一律 `LINKN3测试` 前缀,自建自删。
 * 用法:LIFELOG_CDP_PORT=9222 node scripts/dev-links-accept-n3.mjs(先起 pnpm tauri dev)
 */
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { CDP_PORT, bindMain, ensureMain, open, recorder, sleep, waitFor } from './cdp-lib.mjs';

const NS = 'LINKN3测试';
const TARGET = `${NS} 目标`;
const OTHER = `${NS} 购物清单`;
const SEL = 'textarea[aria-label="输入栏内容"]';
const DB_PATH = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';

const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const pid = Number(sh('powershell', ['-NoProfile', '-Command', "(Get-Process | Where-Object { $_.ProcessName -match '^lifelog$' } | Select-Object -First 1).Id"]).stdout.trim());
/** 输入栏窗口的 OS 可见性(CDP 的 visibilityState 对已隐藏窗口不可靠,故走 Win32 IsWindowVisible) */
const inputVisible = () => {
  const list = JSON.parse(sh('python', ['scripts/win-probe.py', 'list', String(pid)]).stdout || '[]');
  return !!list.find((w) => w.cls === 'Tauri Window' && w.title === '输入栏')?.visible;
};
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

const main = await ensureMain();
const { call } = bindMain(main.cdp);
await call('show_input_bar');
const input = await waitFor(() => open('input').catch(() => null), 20, 250);
if (!input) throw new Error('输入栏页面未出现(检查 input.html 是否已创建)');
const d = input.cdp;
const ev = (expr) => d.eval(expr);

/** 合成输入(与真机打字同路径:原型 setter 让 React onChange 触发 + input 事件喂元素监听) */
const setText = (text) =>
  ev(`(() => { const el = document.querySelector('${SEL}');
    const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    s.call(el, ${JSON.stringify(text)}); el.setSelectionRange(${text.length}, ${text.length});
    el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`);
const keyOn = (key, extra = '') =>
  ev(`(() => { const el = document.querySelector('${SEL}');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true${extra} }));
    return el.value; })()`);
const rowLabels = () => ev(`Array.from(document.querySelectorAll('[data-testid="link-suggest"] button[role="option"]')).map((b) => b.textContent.trim())`);
const dropdownOpen = () => ev(`!!document.querySelector('[data-testid="link-suggest"]')`);
const marks = () => ev(`Array.from(document.querySelectorAll('[data-testid="link-suggest"] mark')).map((m) => m.textContent)`);
const boxState = () => ev(`(() => { const el = document.querySelector('${SEL}'); return { value: el.value, caret: el.selectionStart, len: el.value.length }; })()`);

const stale = await call('query_notes', { conditions: { keyword: NS, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null }, offset: 0 });
for (const n of stale) await call('delete_note', { id: n.id });
await sleep(300);
const base = counts();
console.log(`INFO 基线=${fmt(base)}`);

let failure = null;
try {
  await call('save_input_note', { content: TARGET });
  await call('save_input_note', { content: OTHER });
  const pool = await call('complete_notes');
  await setText('');
  console.log(`INFO 夹具=${fmt([TARGET, OTHER])};池=${pool.length} 条`);

  // --- 读数 3:打 `[[` 出候选 -> 收窄 -> Enter ---
  await setText('[[');
  const eight = await waitFor(async () => {
    const rows = await rowLabels();
    return rows.length > 0 ? rows : null;
  }, 20, 250);
  const selected = await ev(`document.querySelectorAll('[data-testid="link-suggest"] button[aria-selected="true"]').length`);
  await setText('[[LINKN3');
  const two = await waitFor(async () => {
    const rows = await rowLabels();
    return rows.length === 2 ? rows : null;
  }, 20, 250);
  await setText('[[LINKN3测试 目');
  const narrowed = await waitFor(async () => {
    const rows = await rowLabels();
    return rows.length === 1 ? rows : null;
  }, 20, 250);
  const narrowedMarks = await marks();
  const beforeEnter = await boxState();
  await keyOn('Enter');
  const afterAccept = await waitFor(async () => {
    const s = await boxState();
    return s.value === `[[${TARGET}]]` ? s : null;
  }, 20, 250);
  record(
    '读数3 输入栏打 `[[` 出候选 -> 收窄 -> Enter 变 `[[标题]]` 且光标在末尾',
    eight !== null &&
      eight.length === 8 &&
      selected === 1 &&
      two !== null &&
      two.every((l) => l.startsWith(NS)) &&
      narrowed !== null &&
      narrowed[0] === TARGET &&
      narrowedMarks.join('').includes('目') &&
      beforeEnter.value === '[[LINKN3测试 目' &&
      afterAccept?.value === `[[${TARGET}]]` &&
      afterAccept?.caret === afterAccept?.len &&
      (await dropdownOpen()) === false,
    `打[[条数=${eight?.length} 首条=${fmt(eight?.slice(0, 3))} 高亮行=${selected} LINKN3=${fmt(two)} 收窄=${fmt(narrowed)} mark=${fmt(narrowedMarks)} 采纳后=${fmt(afterAccept)}`
  );

  // --- 读数 4:围栏代码块里打 `[[` 不弹 ---
  await setText('```\n[[LINKN3');
  await sleep(500);
  const fencedOpen = await dropdownOpen();
  record('读数4 围栏代码块里打 `[[` 不弹候选', fencedOpen === false, `下拉=${fencedOpen}(期望 false)`);

  // --- 读数 5:Esc 只关下拉(输入栏不隐藏、正文不动);`]]` 出现即退出 ---
  await setText('[[LINKN3');
  await waitFor(() => dropdownOpen(), 20, 250);
  await keyOn('Escape');
  await sleep(400);
  const afterEsc = await boxState();
  const escOpen = await dropdownOpen();
  const escVisible = inputVisible();
  await setText(`[[${TARGET}]]`);
  await sleep(400);
  const closedOpen = await dropdownOpen();
  record(
    '读数5 Esc 只关下拉(输入栏不隐藏、正文不动);`]]` 出现即退出补全',
    escOpen === false && escVisible === true && afterEsc.value === '[[LINKN3' && closedOpen === false,
    `Esc后 下拉=${escOpen} 输入栏可见=${escVisible} 正文=${fmt(afterEsc.value)};闭合后 下拉=${closedOpen}`
  );

  // --- 读数 7:IME 组合态按 Enter 不采纳 ---
  await setText('[[LINKN3测试 目');
  await waitFor(() => dropdownOpen(), 20, 250);
  const imeValue = await keyOn('Enter', ', isComposing: true');
  await sleep(400);
  const imeOpen = await dropdownOpen();
  await keyOn('Enter');
  const afterIme = await waitFor(async () => {
    const s = await boxState();
    return s.value === `[[${TARGET}]]` ? s : null;
  }, 20, 250);
  record(
    '读数7 IME 组合态按 Enter 不采纳,组合结束后照常采纳',
    imeValue === '[[LINKN3测试 目' && imeOpen === true && afterIme?.value === `[[${TARGET}]]`,
    `组合中值=${fmt(imeValue)} 下拉=${imeOpen} 组合后采纳=${fmt(afterIme?.value)}`
  );

  await setText(''); // 清空输入框:已闭合的链接不应被保存
  await sleep(300);
} catch (e) {
  failure = e;
} finally {
  const left = await call('query_notes', { conditions: { keyword: NS, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null }, offset: 0 });
  for (const n of left) await call('delete_note', { id: n.id });
  const gone = await waitFor(async () => {
    const l = await call('query_notes', { conditions: { keyword: NS, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null }, offset: 0 });
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
main.close();
input.close();
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
