// Task 7 修复轮 1 实机验收:输入法组合守卫(审查 C1)。
//   前置:统一输入框输入 `#UI测试`,候选下拉开着(含夹具两条笔记 + 该标签)
//   动作 A:CDP rawKeyDown windowsVirtualKeyCode=229(真实输入法上屏时的 keyCode 形态)
//   动作 B:页面内派发 isComposing:true 的 Enter(只给 isComposing 的 IME 形态)
//   读数:两种形态都不得采纳 —— 下拉行数与内容不变、输入框内容不变、筛选条件仍为空(未 preventDefault)
//   对照:随后再派发普通 Enter -> 正常采纳(证明守卫没挡住正常路径)
// 夹具(UI测试夹具* 笔记 + UI测试 标签)自带清理;notes/tags/tag_links 前后计数在脚本外只读 sqlite 比对。
// 前置:pnpm tauri dev 已在 9222 上跑(origin http://localhost:5173)。
import { ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';

const BOX = '[data-testid="unified-input"]';
const DROP = '[data-testid="unified-dropdown"] li[role="option"]';
const CHIP_AREA = '[aria-label="已生效的筛选条件"]';
const VK = { enter: 13, esc: 27, a: 65, backspace: 8 };
const VK_PROCESS = 229; // 输入法上屏时 Windows 给的是 VK_PROCESSKEY(229)
const CTRL = 2;
const TAG = 'UI测试';
const FIXTURE_NOTES = [`UI测试夹具一 #${TAG}`, `UI测试夹具二 #${TAG}`];

const r = recorder();
let cdp;

const ev = (expr) => cdp.eval(expr);
const key = async (vk, name, code, modifiers = 0, type = 'keyDown') => {
  const base = { key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await cdp.send('Input.dispatchKeyEvent', { type, ...base });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(200);
};
const enter = () => key(VK.enter, 'Enter', 'Enter');
const imeEnter = () => key(VK_PROCESS, 'Enter', 'Enter', 0, 'rawKeyDown'); // rawKeyDown 不带默认动作,只走 keydown
const ctrlEnter = () => key(VK.enter, 'Enter', 'Enter', CTRL);
const esc = () => key(VK.esc, 'Escape', 'Escape');
const focusBox = () => ev(`(() => { const el = document.querySelector('${BOX}'); if (!el) return false; el.focus(); return true; })()`);
const type = async (text) => { await cdp.send('Input.insertText', { text }); await sleep(450); };
/** 清空输入框:真按键(Ctrl+A -> Backspace),不用合成 DOM 赋值 */
const clearBox = async () => {
  await focusBox();
  await key(VK.a, 'a', 'KeyA', CTRL);
  await key(VK.backspace, 'Backspace', 'Backspace');
  return ev(`document.querySelector('${BOX}').value`);
};
const value = () => ev(`document.querySelector('${BOX}').value`);
const rows = () =>
  ev(`Array.from(document.querySelectorAll('${DROP}')).map((li) => li.getAttribute('data-row-id'))`);
const chips = () =>
  ev(`Array.from(document.querySelectorAll('${CHIP_AREA} [aria-label^="移除条件"]')).map((b) =>
    b.getAttribute('aria-label').replace('移除条件 ', ''))`);
const clearChips = async () => {
  for (let i = 0; i < 6; i++) {
    const n = await ev(`(() => { const b = document.querySelector('${CHIP_AREA} [aria-label^="移除条件"]'); if (!b) return 0; b.click(); return 1; })()`);
    if (!n) break;
    await sleep(320);
  }
};
const streamCount = () => ev(`document.querySelectorAll('[data-note-body]').length`);
const call = (cmd, args = {}) => ev(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
/** 记录页面上收到的 keydown(keyCode/isComposing 的真实读数);监听挂在 textarea 上,早于 React 的根监听 */
const watchKeys = () => ev(`(() => { window.__t7keys = [];
  document.querySelector('${BOX}').addEventListener('keydown', (e) =>
    window.__t7keys.push({ key: e.key, keyCode: e.keyCode, isComposing: e.isComposing }), true);
  return true; })()`);
const lastKey = () => ev(`window.__t7keys[window.__t7keys.length - 1] ?? null`);
/** 只给 isComposing 的形态:页面内真派发(CDP 的 dispatchKeyEvent 没有 isComposing 参数) */
const composingEnter = () => ev(`(() => {
  const e = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true });
  document.querySelector('${BOX}').dispatchEvent(e);
  return { isComposing: e.isComposing, defaultPrevented: e.defaultPrevented }; })()`);
/** 同一读数的快照:下拉行 / 输入框内容 / 筛选条件 */
const snapshot = async () => ({ rows: await rows(), value: await value(), chips: await chips() });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const fixtureIds = async () =>
  (await call('query_notes', {
    conditions: { keyword: 'UI测试夹具', tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null },
    offset: 0,
  })).map((n) => n.id);

async function main() {
  const conn = await ensureMain();
  cdp = conn.cdp;
  await cdp.send('Page.reload');
  await waitFor(() => ev(`!!document.querySelector('${BOX}')`).catch(() => false), 60, 500);
  await sleep(1200);
  await watchKeys();

  // --- 夹具:两条带 UI测试 标签的笔记,走真实保存路径(Ctrl+Enter) ---
  await clearChips();
  for (const text of FIXTURE_NOTES) {
    await clearBox();
    await type(text);
    await ctrlEnter();
    await sleep(700);
  }
  const leftNotes0 = (await fixtureIds()).length;
  r.record('夹具就绪', leftNotes0 === 2, `已保存夹具笔记 ${leftNotes0} 条(真实 Ctrl+Enter 路径)`);

  // --- 前置:`#UI测试` 候选下拉开着 ---
  await clearBox();
  await type(`#${TAG}`);
  const tagRows = await waitFor(async () => { const rs = await rows(); return rs.length > 0 ? rs : null; }, 12, 250);
  const before = await snapshot();
  r.record('前置:候选下拉在场且筛选条件为空', tagRows !== null && before.chips.length === 0,
    `下拉 ${before.rows.length} 行 = ${JSON.stringify(before.rows)};输入框=${JSON.stringify(before.value)};条件=${JSON.stringify(before.chips)}`);

  // --- 动作 A:keyCode 229(真实 IME 上屏形态;rawKeyDown 不带默认动作,只走 keydown) ---
  await focusBox();
  await imeEnter();
  await sleep(500);
  const k229 = await lastKey();
  const afterA = await snapshot();
  r.record('A. keyCode 229 的 Enter 不采纳(下拉/内容/条件全不变)', k229?.keyCode === 229 && same(afterA, before),
    `页面收到 keyCode=${k229?.keyCode} isComposing=${k229?.isComposing};下拉 ${afterA.rows.length} 行(前 ${before.rows.length});` +
    `输入框=${JSON.stringify(afterA.value)};条件=${JSON.stringify(afterA.chips)}`);

  // --- 动作 B:isComposing:true 的 Enter ---
  const b = await composingEnter();
  await sleep(500);
  const afterB = await snapshot();
  r.record('B. isComposing:true 的 Enter 不采纳且未被消费(preventDefault=false)', b.isComposing === true && b.defaultPrevented === false && same(afterB, before),
    `页面读出 isComposing=${b.isComposing} defaultPrevented=${b.defaultPrevented};下拉 ${afterB.rows.length} 行;` +
    `输入框=${JSON.stringify(afterB.value)};条件=${JSON.stringify(afterB.chips)}`);

  // --- 对照:普通 Enter 必须照旧采纳(守卫只挡组合态) ---
  await enter();
  await sleep(900);
  const afterC = await snapshot();
  const stream = await streamCount();
  r.record('对照:普通 Enter 正常采纳(下拉收起、加上包含条件、流只剩夹具 2 条)',
    afterC.rows.length === 0 && afterC.chips.length === 1 && afterC.chips[0] === `⊢ #${TAG}` && stream === 2,
    `下拉 ${afterC.rows.length} 行;条件=${JSON.stringify(afterC.chips)};流条数=${stream}`);

  // --- 清理:条件/输入/夹具笔记与标签 ---
  await clearBox();
  await esc();
  await clearChips();
  const ids = await fixtureIds();
  for (const id of ids) await call('delete_note', { id });
  const leftover = (await call('list_tags')).filter((t) => t.path === TAG || t.path.startsWith(TAG + '/'));
  for (const t of leftover) await call('delete_tag', { tagId: t.id });
  await sleep(700);
  const leftTags = (await call('list_tags')).filter((t) => t.path.startsWith(TAG)).length;
  r.record('夹具清理', (await fixtureIds()).length === 0 && leftTags === 0,
    `删除夹具笔记 ${ids.length} 条、夹具标签 ${leftover.length} 个(${JSON.stringify(leftover.map((t) => t.path))});剩余笔记 0、标签 ${leftTags}`);

  r.finish();
  conn.close();
}

main().catch((e) => {
  console.error('FAIL 脚本异常:', e?.message ?? e);
  process.exitCode = 1;
});
