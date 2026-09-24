// 修复轮 1 实机验收(跨侧去重;键鼠全走 CDP Input,不碰物理鼠标):
//   前置条件:排除侧已有 `UI测试A`(走 FilterBar「添加条件 -> 排除标签」)
//   动作:统一输入框输入 `#UI测试A` + Enter
//   读数:条件栏**只有一个**包含侧 chip(`⊢ #UI测试A`)、`排除` chip 消失、流条数回到夹具数
// 夹具(UI测试A夹具* 笔记 + UI测试A 标签)自带清理;notes/tags/tag_links 前后计数在脚本外只读 sqlite 比对。
// 前置:pnpm tauri dev 已在 9222 上跑(origin http://localhost:5173)。
import { ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';

const BOX = '[data-testid="unified-input"]';
const CHIP_AREA = '[aria-label="已生效的筛选条件"]';
const DROP = '[data-testid="unified-dropdown"] li[role="option"]';
const VK = { enter: 13, esc: 27, a: 65, backspace: 8 };
const CTRL = 2;
const TAG = 'UI测试A';
const FIXTURE_NOTES = [`UI测试A夹具一 #${TAG}`, `UI测试A夹具二 #${TAG}`];

const r = recorder();
let cdp;

const ev = (expr) => cdp.eval(expr);
const key = async (vk, name, code, modifiers = 0) => {
  const base = { key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(200);
};
const enter = () => key(VK.enter, 'Enter', 'Enter');
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
const rows = () =>
  ev(`Array.from(document.querySelectorAll('${DROP}')).map((li) => ({ id: li.getAttribute('data-row-id'),
    label: li.textContent.trim() }))`);
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
/** 走 FilterBar 的真实入口把标签放进**排除侧**:添加条件 -> 排除标签 -> 标签选择器点该行 */
const addExcludeTag = async (path) => {
  await ev(`Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim().startsWith('添加条件'))?.click()`);
  await sleep(300);
  await ev(`Array.from(document.querySelectorAll('[role="menuitem"]')).find((b) => b.textContent.trim() === '排除标签')?.click()`);
  await sleep(900);
  const clicked = await ev(`(() => { const d = document.querySelector('[role="dialog"][aria-label="排除标签"]');
    const b = d && Array.from(d.querySelectorAll('button')).find((x) => x.getAttribute('title') === ${JSON.stringify(path)});
    if (!b) return false; b.click(); return true; })()`);
  await sleep(700);
  return clicked;
};

async function main() {
  const conn = await ensureMain();
  cdp = conn.cdp;
  await cdp.send('Page.reload');
  await waitFor(() => ev(`!!document.querySelector('${BOX}')`).catch(() => false), 60, 500);
  await sleep(1200);

  // --- 夹具:两条带 UI测试A 标签的笔记,走真实保存路径 ---
  await clearChips();
  for (const text of FIXTURE_NOTES) {
    await clearBox();
    await type(text);
    await ctrlEnter();
    await sleep(700);
  }
  const streamAfterSave = await streamCount();
  r.record('夹具就绪', streamAfterSave >= 2, `流条数=${streamAfterSave}(首屏上限内,夹具 2 条在其中)`);

  // --- 前置:排除侧已有 UI测试A(条件栏应出现「排除 ⊢ #UI测试A」) ---
  const added = await addExcludeTag(TAG);
  const beforeChips = await chips();
  const beforeCount = await streamCount();
  r.record('前置:排除侧已有该标签', added === true && beforeChips.length === 1 && beforeChips[0].includes('排除') && beforeChips[0].includes(TAG),
    `选择器点中=${added};chips=${JSON.stringify(beforeChips)};流条数=${beforeCount}(2 条夹具被排除,其余笔记照常显示)`);

  // --- 主读数:统一输入框 `#UI测试A` + Enter ---
  await clearBox();
  await type(`#${TAG}`);
  const tagRows = await waitFor(async () => { const rs = await rows(); return rs.length > 0 ? rs : null; }, 12, 250);
  r.record('`#` 候选在场', (tagRows?.[0]?.id ?? '') === TAG, `候选 ${tagRows?.length ?? 0} 行,首行 id=${tagRows?.[0]?.id ?? '-'}`);
  await enter();
  await sleep(900);

  const afterChips = await chips();
  const afterCount = await streamCount();
  const oneIncludeChip = afterChips.length === 1 && afterChips[0] === `⊢ #${TAG}`;
  const noExcludeChip = !afterChips.some((c) => c.startsWith('排除'));
  r.record('主读数:采纳后只剩包含侧 chip', oneIncludeChip && noExcludeChip,
    `chips=${JSON.stringify(afterChips)};排除侧 chip=${noExcludeChip ? '无' : '仍在'};流条数=${afterCount}(应恢复为 2)`);
  r.record('主读数:excludeTags 已清(不与 tags 并存 -> 不是 0 条)', afterCount === 2,
    `采纳前 ${beforeCount} 条(仅排除侧生效:夹具被排除)-> 采纳后 ${afterCount} 条(仅包含侧生效:正好 2 条夹具);若 excludeTags 残留,该条件会恒 0 条`);

  // --- 清理:条件/输入/夹具笔记与标签 ---
  await clearBox();
  await esc();
  await clearChips();
  const ids = (await call('query_notes', {
    conditions: { keyword: 'UI测试A夹具', tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null },
    offset: 0,
  })).map((n) => n.id);
  for (const id of ids) await call('delete_note', { id });
  const leftover = (await call('list_tags')).filter((t) => t.path === TAG || t.path.startsWith(TAG + '/'));
  for (const t of leftover) await call('delete_tag', { tagId: t.id });
  await sleep(700);
  const leftNotes = (await call('query_notes', {
    conditions: { keyword: 'UI测试A夹具', tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null },
    offset: 0,
  })).length;
  const leftTags = (await call('list_tags')).filter((t) => t.path.startsWith(TAG)).length;
  r.record('夹具清理', leftNotes === 0 && leftTags === 0,
    `删除夹具笔记 ${ids.length} 条;剩余夹具笔记 ${leftNotes}、夹具标签 ${leftTags}(清理标签 ${JSON.stringify(leftover.map((t) => t.path))})`);

  r.finish();
  conn.close();
}

main().catch((e) => {
  console.error('FAIL 脚本异常:', e?.message ?? e);
  process.exitCode = 1;
});
