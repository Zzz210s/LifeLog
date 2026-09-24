// Task 6 实机验收(4 条读数;键鼠全走 CDP Input,不碰物理鼠标):
//   ① `/UI测试` 300ms 后流被筛且 stat 显示命中数  ② `#UI测试` -> Enter -> 条件栏出现该 chip
//   ③ `@UI测试` -> Enter -> 该条滚进视野          ④ `>` -> Enter -> 命令执行且勾选态跟着变
// 夹具(UI测试夹具* 笔记 + UI测试* 标签)自带清理:跑完删净,前后计数在脚本外比对。
// 前置:pnpm tauri dev 已在 9222 上跑(origin http://localhost:5173)。
import { ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';

const BOX = '[data-testid="unified-input"]';
const STAT = '[data-testid="prefix-stat"]';
const CHIP_AREA = '[aria-label="已生效的筛选条件"]';
const DROP = '[data-testid="unified-dropdown"] li[role="option"]';
const VK = { enter: 13, esc: 27, a: 65, backspace: 8 };
const CTRL = 2;
const FIXTURE_TAG = 'UI测试';
const FIXTURE_NOTES = [`UI测试夹具一 #${FIXTURE_TAG}`, `UI测试夹具二 #${FIXTURE_TAG}`, 'UI测试夹具三'];

const r = recorder();
let cdp;

const key = async (vk, name, code, modifiers = 0) => {
  const base = { key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(200);
};
const enter = () => key(VK.enter, 'Enter', 'Enter');
const ctrlEnter = () => key(VK.enter, 'Enter', 'Enter', CTRL);
const esc = () => key(VK.esc, 'Escape', 'Escape');
const ev = (expr) => cdp.eval(expr);
const focusBox = () => ev(`(() => { const el = document.querySelector('${BOX}'); if (!el) return false; el.focus(); return true; })()`);
const boxValue = () => ev(`document.querySelector('${BOX}').value`);
const type = async (text) => {
  await cdp.send('Input.insertText', { text });
  await sleep(420);
};
/** 清空输入框:真按键(Ctrl+A -> Backspace),不用合成 DOM 赋值 */
const clearBox = async () => {
  await focusBox();
  await key(VK.a, 'a', 'KeyA', CTRL);
  await key(VK.backspace, 'Backspace', 'Backspace');
  return boxValue();
};
const rows = () =>
  ev(`Array.from(document.querySelectorAll('${DROP}')).map((li) => ({ id: li.getAttribute('data-row-id'),
    label: li.textContent.trim(), checked: li.textContent.includes('已勾选') }))`);
const chips = () =>
  ev(`Array.from(document.querySelectorAll('${CHIP_AREA} [aria-label^="移除条件"]')).map((b) => b.getAttribute('aria-label').replace('移除条件 ', ''))`);
const clearChips = async () => {
  for (let i = 0; i < 6; i++) {
    const n = await ev(`(() => { const b = document.querySelector('${CHIP_AREA} [aria-label^="移除条件"]'); if (!b) return 0; b.click(); return 1; })()`);
    if (!n) break;
    await sleep(320);
  }
};
const streamCount = () => ev(`document.querySelectorAll('[data-note-body]').length`);
const stat = () => ev(`document.querySelector('${STAT}')?.textContent ?? null`);
const call = (cmd, args = {}) => ev(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const sidebar = () => ev(`!!document.querySelector('aside[data-testid="sidebar"]')`);
const scrollToBottom = () =>
  ev(`(() => { const sc = document.querySelector('[data-note-body]')?.closest('.scroll-gutter');
    if (!sc) return -1; sc.scrollTop = sc.scrollHeight; return sc.scrollTop; })()`);
/** 该笔记行是否落在信息流可视区内(顺带回传 scrollTop) */
const noteInView = (id) =>
  ev(`(() => { const el = document.querySelector('[data-note-body="${id}"]');
    if (!el) return { found: false };
    const sc = el.closest('.scroll-gutter');
    const a = el.getBoundingClientRect(), c = (sc ?? document.body).getBoundingClientRect();
    return { found: true, inView: a.top >= c.top && a.bottom <= c.bottom, scrollTop: sc?.scrollTop ?? -1 }; })()`);
const noteIds = async () => {
  const rows = await call('query_notes', {
    conditions: { keyword: 'UI测试夹具', tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null },
    offset: 0,
  });
  return rows.map((n) => n.id);
};

async function main() {
  const conn = await ensureMain();
  cdp = conn.cdp;
  await cdp.send('Page.reload');
  await waitFor(() => ev(`!!document.querySelector('${BOX}')`).catch(() => false), 60, 500);
  await sleep(1200);
  const sidebarBefore = await sidebar();

  // --- 夹具:三条笔记(两条带 UI测试 标签),走真实保存路径 ---
  for (const text of FIXTURE_NOTES) {
    await clearBox();
    await type(text);
    await ctrlEnter();
    await sleep(600);
  }
  const ids = await noteIds();
  r.record('夹具就绪', ids.length === 3, `UI测试夹具* 笔记 ${ids.length} 条, id=${JSON.stringify(ids)}`);
  if (ids.length !== 3) throw new Error('夹具笔记未创建成功,中止');
  const target = ids[0]; // 最新一条(流里在最前)

  // --- ① `/` 实时筛选:300ms 防抖后流被筛,stat 给命中数与排序 ---
  await clearChips();
  await clearBox();
  await type('/UI测试');
  const filtered = await waitFor(async () => ((await streamCount()) === 3 ? true : false), 12, 250);
  const statText = await stat();
  r.record('① `/` 实时筛选', filtered === true && (statText ?? '').includes('命中 3 条'),
    `流条数=${await streamCount()} stat="${statText}"`);

  // --- ② `#` 选标签 -> 条件补丁(含子级),chip 出现 ---
  await clearChips();
  await clearBox();
  await type(`#${FIXTURE_TAG}`);
  const tagRows = await waitFor(async () => { const rs = await rows(); return rs.length > 0 ? rs : null; }, 12, 250);
  await enter();
  await sleep(700);
  const chipTexts = await chips();
  r.record('② `#` 采纳 -> 条件 chip', (chipTexts[0] ?? '').includes(`#${FIXTURE_TAG}`) && (chipTexts[0] ?? '').startsWith('⊢'),
    `候选 ${tagRows?.length ?? 0} 行(首行 ${tagRows?.[0]?.label ?? '-'});chip=${JSON.stringify(chipTexts)}`);

  // --- ③ `@` 选笔记 -> 滚进视野(先把流滚到底,让目标行确实在视野外) ---
  await clearChips();
  await clearBox();
  await sleep(500);
  const scrolled = await scrollToBottom();
  const before = await noteInView(target);
  await type('@UI测试');
  await waitFor(async () => ((await rows()).length > 0 ? true : false), 12, 250);
  await enter();
  await sleep(900);
  const after = await noteInView(target);
  r.record('③ `@` 采纳 -> 滚进视野', after.found && after.inView === true && before.inView === false,
    `滚到底 scrollTop=${scrolled};滚前 inView=${before.inView};滚后 inView=${after.inView}(scrollTop=${after.scrollTop})`);

  // --- ④ `>` 命令:候选行数、执行后勾选态翻转(侧栏开关的 toggled) ---
  await clearBox();
  await type('>');
  const allRows = await rows();
  const noMatch = await (async () => { await clearBox(); await type('>最新'); const rs = await rows(); return rs.length; })();
  await clearBox();
  await type('>侧栏');
  const beforeRow = (await rows())[0];
  await enter();
  await sleep(800);
  const hidden = await sidebar();
  await clearBox();
  await type('>侧栏');
  const afterRow = (await rows())[0];
  await enter();
  await sleep(800);
  const restored = await sidebar();
  const flipped = beforeRow?.label !== afterRow?.label && beforeRow?.checked !== afterRow?.checked;
  r.record('④ `>` 命令执行 + 勾选态', allRows.length >= 9 && flipped && hidden === false && restored === sidebarBefore,
    `候选 ${allRows.length} 行;侧栏 ${beforeRow?.label}(checked=${beforeRow?.checked}) -> ${afterRow?.label}(checked=${afterRow?.checked});` +
      `侧栏可见 ${sidebarBefore}->${hidden}->${restored};">最新" 候选 ${noMatch} 行(命令表无排序命令,读数见报告)`);

  // --- 清理:输入/条件/夹具笔记与标签 ---
  await clearBox();
  await esc();
  await clearChips();
  for (const id of ids) await call('delete_note', { id });
  const leftoverTags = (await call('list_tags')).filter((t) => t.path === FIXTURE_TAG || t.path.startsWith(FIXTURE_TAG + '/'));
  for (const t of leftoverTags) await call('delete_tag', { tagId: t.id });
  await sleep(600);
  const gone = await noteIds();
  const tagLeft = (await call('list_tags')).filter((t) => t.path.startsWith(FIXTURE_TAG));
  r.record('夹具清理', gone.length === 0 && tagLeft.length === 0,
    `剩余夹具笔记 ${gone.length} 条、夹具标签 ${tagLeft.length} 个(删除标签 ${JSON.stringify(leftoverTags.map((t) => t.path))})`);

  r.finish();
  conn.close();
}

main().catch((e) => {
  console.error('FAIL 脚本异常:', e?.message ?? e);
  process.exitCode = 1;
});
