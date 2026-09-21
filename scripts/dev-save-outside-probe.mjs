#!/usr/bin/env node
/**
 * 「点编辑区块外 = 保存」的改后读数探针(真实 release 库;夹具笔记自建自删)。
 * 六条口径:未变不写库 / 空内容保持编辑态 + 中文错误 / 保存失败(见 DOM 测试的 mock 证据)/
 * 点另一条先存后进 / Esc = 取消 / 输入栏行为零变化。
 * 「有没有写库」用只读快照的 主库+WAL mtime 与笔记内容对照(notes 表没有 updated_at,只能这样取证)。
 * 用法:node scripts/dev-save-outside-probe.mjs  产物:readings/save-after.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { ensureMain, sleep, waitFor, bindMain, open } from './cdp-lib.mjs';
import { PAGE } from './save-outside-page.mjs';
import { snapshot, untouched } from './db-snapshot.mjs';

const OUT = '.superpowers/sdd/2026-09-21-dnd/readings/save-after.json';
const MARK = 'SAVEPROBE';
const { cdp, close } = await ensureMain();
const { call, inventory } = bindMain(cdp);
const ev = (expr) => cdp.eval(`(async () => { ${PAGE}; return await ${expr}; })()`);
const J = JSON.stringify;
const R = { meta: {}, steps: {}, input: {}, cleanup: {} };
const probeContent = () => snapshot().probe.map(([, c]) => c);
/** 关掉可能开着的编辑面板(上一步崩溃/失败时的兜底),并返回当前状态 */
const reset = async () => { await ev('__SAVE__.esc()').catch(() => {}); await sleep(250); return ev('__SAVE__.state()'); };
/** 进编辑 + 可选改文本,然后重读状态(避免依赖页面函数返回值) */
const edit = async (id, text) => { await reset(); await ev(`__SAVE__.enter(${id})`); if (text !== undefined) await ev(`__SAVE__.type(${J(text)})`); await sleep(150); return ev('__SAVE__.state()'); };
const touched = (a, b) => !untouched(a, b);
const flag = (a, b) => ({ dbSame: JSON.stringify(a.db) === JSON.stringify(b.db), walSame: JSON.stringify(a.wal) === JSON.stringify(b.wal), wrote: touched(a, b) });
const wrote = (snap, text) => snap.probe.some(([, c]) => c === text);

const stale = await call('query_notes', {
  conditions: { keyword: MARK, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null },
  offset: 0,
});
for (const n of stale) {
  await call('delete_note', { id: n.id });
  console.log('清掉上一轮残留夹具笔记:', n.id);
}
const invBefore = await inventory();
const fix = await call('save_input_note', { content: `${MARK} 原始正文` });
const visible = await waitFor(() => ev(`__SAVE__.ids().includes(${fix.id})`), 24, 250);
const ids = await ev('__SAVE__.ids()');
R.meta = { noteId: fix.id, rowVisible: !!visible, visibleIds: ids.slice(0, 6), inventoryNotes: invBefore.notes };
console.log('夹具:', fix.id, '行可见=', !!visible, '可见笔记=', ids.slice(0, 6).join(','));
if (!visible) {
  console.log('WARN 夹具行不在当前信息流(DOM)里:保存判定改由 DOM 单测取证');
  writeFileSync(OUT, JSON.stringify(R, null, 1));
  close();
  process.exit(0);
}

const step = async (name, fn) => {
  const r = await fn();
  R.steps[name] = r;
  console.log(name, J({ editing: r.state && r.state.editing, error: r.state && r.state.error, db: r.db }));
};

// ① 区块内点击 = 继续编辑;区块外未变 = 退出编辑且不写库(主库与 WAL 的 md5 全程不动)
await edit(fix.id);
const inside = await ev('__SAVE__.inside()');
const sn1 = snapshot();
await ev('__SAVE__.outside()');
await sleep(250);
const afterUnchanged = await ev('__SAVE__.state()');
const sn2 = snapshot();
R.steps.insideClick = { state: inside };
R.steps.outsideUnchanged = { state: afterUnchanged, db: { contentAfter: probeContent(), ...flag(sn1, sn2) } };
console.log('① 区块内点击: 仍编辑中=', inside.editing, '| 区块外未变: 退出=', !afterUnchanged.editing, '| 未写库=', !flag(sn1, sn2).wrote);

// ② 改过内容 + 点区块外 = 写库
const beforeChanged = await edit(fix.id, `${MARK} 改后正文`);
const sn3 = snapshot();
await ev('__SAVE__.outside()');
await sleep(450);
const afterChanged = await ev('__SAVE__.state()');
const sn4 = snapshot();
R.steps.outsideChanged = { state: afterChanged, textBefore: beforeChanged.source, db: { contentAfter: probeContent(), wroteChanged: wrote(sn4, `${MARK} 改后正文`), ...flag(sn3, sn4) } };
console.log('② 改后点外: 退出=', !afterChanged.editing, '库内=', J(probeContent()), '写了库=', flag(sn3, sn4).wrote);

// ③ 空内容 + 点区块外 = 保持编辑态 + 中文错误,不写库
const beforeEmpty = await edit(fix.id, '   ');
const sn5 = snapshot();
await ev('__SAVE__.outside()');
await sleep(350);
const afterEmpty = await ev('__SAVE__.state()');
const sn6 = snapshot();
R.steps.outsideEmpty = { state: afterEmpty, textBefore: beforeEmpty.source, db: { contentAfter: probeContent(), ...flag(sn5, sn6) } };
console.log('③ 空内容点外: 仍编辑中=', afterEmpty.editing, '错误=', J(afterEmpty.error), '文本保留=', J(afterEmpty.source), '未写库=', !flag(sn5, sn6).wrote);

// ④ 点另一条笔记正文 = 先存后进
const otherId = ids.find((x) => x !== fix.id);
await edit(fix.id, `${MARK} 第二次修改`);
const sn7 = snapshot();
await ev(`__SAVE__.outside(${otherId})`);
await sleep(600);
const afterSwitch = await ev('__SAVE__.state()');
const sn8 = snapshot();
R.steps.switchNote = { otherId, state: afterSwitch, db: { contentAfter: probeContent(), wroteFirst: wrote(sn8, `${MARK} 第二次修改`), ...flag(sn7, sn8) } };
console.log('④ 点另一条正文(id=', otherId, '): 仍编辑中=', afterSwitch.editing, '已切到该条源码=', J((afterSwitch.source || '').slice(0, 20)), '第一条已写库=', wrote(sn8, `${MARK} 第二次修改`));

// ⑤ Esc = 取消(不写库)
const beforeEsc = await edit(fix.id, `${MARK} 不该保存`);
const sn9 = snapshot();
await ev('__SAVE__.esc()');
await sleep(350);
const afterEsc = await ev('__SAVE__.state()');
const sn10 = snapshot();
R.steps.esc = { state: afterEsc, textBefore: beforeEsc.source, db: { contentAfter: probeContent(), wroteCancelled: wrote(sn10, `${MARK} 不该保存`), ...flag(sn9, sn10) } };
console.log('⑤ Esc: 退出=', !afterEsc.editing, '未写入=', !wrote(sn10, `${MARK} 不该保存`), '未写库=', !flag(sn9, sn10).wrote);

// ⑥ 输入栏:Ctrl+Enter 仍保存(真写库);点输入栏外既不保存也不新增
const INPUT = `window.__IN__ = (() => { const ta = () => document.querySelector('textarea[aria-label="输入栏内容"]');
  const tick = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 150 : ms));
  const type = (v) => { const el = ta(); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  return { state: () => ({ text: ta() ? ta().value : null, visible: document.visibilityState }),
    type, ctrlEnter: async () => { ta().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); await tick(500); return window.__IN__.state(); },
    outside: async () => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 5, clientY: 5, pointerId: 1, isPrimary: true })); await tick(300); return window.__IN__.state(); } };
})(); 'ok'`;
const inputConn = await open('input').catch((e) => null);
if (!inputConn) {
  R.input = { skipped: '输入栏页面未找到(未以 9222 启动或输入栏未创建)' };
} else {
  const iev = (expr) => inputConn.cdp.eval(`(async () => { ${INPUT}; return await ${expr}; })()`);
  const marks = [`${MARK} 输入栏保存`, `${MARK} 输入栏点外不该保存`];
  const invInput0 = await inventory();
  await iev(`__IN__.type(${J(marks[0])})`);
  const afterCtrlEnter = await iev('__IN__.ctrlEnter()');
  await sleep(500);
  const foundSaved = await call('query_notes', {
    conditions: { keyword: marks[0], tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null },
    offset: 0,
  });
  await iev(`__IN__.type(${J(marks[1])})`);
  const beforeOutside = await iev('__IN__.state()');
  const afterOutside = await iev('__IN__.outside()');
  await sleep(400);
  const foundOutside = await call('query_notes', {
    conditions: { keyword: marks[1], tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null },
    offset: 0,
  });
  R.input = {
    ctrlEnter: { savedCount: foundSaved.length, savedId: foundSaved[0] && foundSaved[0].id, state: afterCtrlEnter },
    outside: { createdCount: foundOutside.length, beforeOutside, afterOutside, textKept: beforeOutside.text === afterOutside.text },
    inventoryDelta: (await inventory()).notes - invInput0.notes,
  };
  for (const n of foundSaved) await call('delete_note', { id: n.id });
  console.log('⑥ 输入栏 Ctrl+Enter 新增=', foundSaved.length, '| 点输入栏外新增=', foundOutside.length, '文本保留=', R.input.outside.textKept);
  inputConn.close();
}

await call('delete_note', { id: fix.id });
await sleep(800);
const invAfter = await inventory();
R.cleanup = {
  noteId: fix.id,
  leftovers: (await call('query_notes', { conditions: { keyword: MARK, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null }, offset: 0 })).map((n) => n.id),
  notes: `${invAfter.notes}/${invBefore.notes}`,
  invSame: J(invBefore.ids) === J(invAfter.ids) && J(invBefore.paths) === J(invAfter.paths) && invBefore.tags === invAfter.tags,
  probeRows: probeContent(),
};
console.log('收尾:', J(R.cleanup));
mkdirSync(OUT.slice(0, OUT.lastIndexOf('/')), { recursive: true });
writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log('读数已写:', OUT);
close();
