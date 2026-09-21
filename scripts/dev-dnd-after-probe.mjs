#!/usr/bin/env node
/**
 * 标签拖拽重做(T1-T8)的「改后读数」探针:页面内合成 DragEvent,不碰 OS 鼠标;真实库只读
 * (只允许自建 DND测试* 夹具的内部移动),夹具与临时笔记收尾删净并给库存前后逐项对照。
 * 用法:node scripts/dev-dnd-after-probe.mjs(被测:release exe + 9222 CDP)
 * 产物:.superpowers/sdd/2026-09-21-dnd/readings/dnd-after.json
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ensureMain, sleep, waitFor, bindMain } from './cdp-lib.mjs';
import { PAGE } from './dnd-after-page.mjs';

const OUT = '.superpowers/sdd/2026-09-21-dnd/readings/dnd-after.json';
const ROOT = 'DND测试';
const SRC = `${ROOT}/甲`;
const TGT = `${ROOT}/目标`;
const SIB = `${TGT}/乙`;
const CHILD = `${TGT}/子`;
const GRAND = `${CHILD}/孙`;
const NOTE = `#${SRC} #${SIB} #${GRAND} DND夹具`;
const DB = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
const SQL = `import json,sqlite3
c=sqlite3.connect('file:${DB}?mode=ro',uri=True)
print(json.dumps({'notes':c.execute('select count(*) from notes').fetchone()[0],
'tags':c.execute('select count(*) from tags').fetchone()[0],
'links':c.execute('select count(*) from tag_links').fetchone()[0],
'roots':c.execute('select path,sort_order from tags where parent_id is null order by path').fetchall(),
'sidecar':c.execute("select path from tags where path like 'DND测试%' order by path").fetchall()}))`;
const db = () => JSON.parse(execFileSync('python', ['-c', SQL], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }).toString());

const { cdp, close } = await ensureMain();
const { call, inventory, paths } = bindMain(cdp);
const ev = (expr) => cdp.eval(`(async () => { ${PAGE}; return await ${expr}; })()`);
const J = JSON.stringify;
const R = { meta: {}, t1: {}, t2: null, t3: null, t4: {}, t5: null, t6: null, t7: null, t8: null, drops: {}, cleanup: {} };
const fixtureTags = async () => (await paths()).filter((p) => p === ROOT || p.startsWith(ROOT + '/')).sort();

console.log('页面探针注入:', (await ev('__DND__.state().gapCount')) === 0 ? 'ok' : 'fail');
const stale = await call('query_notes', {
  conditions: { keyword: 'DND夹具', tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null },
  offset: 0,
});
for (const n of stale) await call('delete_note', { id: n.id });
if (stale.length) {
  console.log('清掉上一轮残留夹具笔记:', stale.map((n) => n.id).join(','));
  await sleep(900);
  const rootList = await call('list_tags');
  for (const t of rootList.filter((t) => t.path === ROOT || t.path.startsWith(ROOT + '/')).sort((a, b) => b.depth - a.depth)) {
    await call('delete_tag', { tagId: t.id });
  }
}
const dbBefore = db();
const invBefore = await inventory();

const fix = await call('save_input_note', { content: NOTE });
const ready = await waitFor(() => ev(`__DND__.ensureExpanded(${J(TGT)}, ${J(CHILD)})`), 20, 300);
console.log('夹具就位:', !!ready, 'noteId=', fix && fix.id, 'tags=', (await fixtureTags()).join(' , '));
const sc = await ev('(() => { const l = __DND__.list(); return { clientHeight: l.clientHeight, scrollHeight: l.scrollHeight, scrollTop: l.scrollTop, rows: document.querySelectorAll("[data-tag-path]").length, rowOrder: Array.from(document.querySelectorAll("[data-tag-path]")).map((e) => e.getAttribute("data-tag-path")).filter((p) => p.startsWith("DND测试")) }; })()');
R.meta = { dbBefore, notes: invBefore.notes, tagCountIPC: invBefore.paths.length, fixtureNoteId: fix && fix.id, fixtureTags: await fixtureTags(), list: sc };

for (const dir of ['bottom', 'top']) {
  R.t1[dir] = await ev(`__DND__.t1(${J(dir)}, ${J(TGT)}, false)`);
  console.log('T1', dir, 'delta=', R.t1[dir].delta, 'px  maxFrame=', R.t1[dir].maxFrameDelta, 'minFrame=', R.t1[dir].minFrameDelta, '阻止默认=', R.t1[dir].prevented, '静止 900ms 追加位移=', R.t1[dir].idleDelta);
}
R.t2 = await ev(`__DND__.t2(${J(TGT)}, ${J(CHILD)}, ${J(SRC)})`);
console.log('T2 折叠=', R.t2.collapsed, '500ms 后展开=', R.t2.sawExpandedAt600ms, '悬停落点=', J(R.t2.stateDuringHover.over));
R.t3 = await ev(`__DND__.t3(${J(TGT)}, [0.1, 0.35, 0.6, 0.9], ${J(SRC)}, true)`);
console.log('T3 命中:', J(R.t3.byRatio.map((b) => ({ r: b.ratio, hit: (b.hit && (b.hit.path || b.hit.band)) || b.hit.tag, over: b.over, line: b.lineCount }))));
R.t3.alt = await ev(`__DND__.t3(${J(TGT)}, [0.1, 0.9], ${J(SIB)}, false)`);
console.log('T3 对照(源=目标/乙,非无变化):', J(R.t3.alt.byRatio.map((b) => ({ r: b.ratio, hit: (b.hit && (b.hit.path || b.hit.band)) || b.hit.tag, over: b.over, line: b.lineCount }))));
console.log('T3 边界带:', J(R.t3.bands.map((b) => ({ anchor: b.anchor, zone: b.zone, half: b.half, over: b.over, line: b.lineCount }))), '最大线数=', R.t3.maxLineCount);
R.t5 = await ev(`__DND__.t5(${J(TGT)}, ${J(SRC)}, ${J(ROOT)})`);
console.log('T5 源行 opacity=', R.t5.sourceRow.opacity, '| 成为子级背景=', R.t5.child.background, 'boxShadow=', R.t5.child.boxShadow);
console.log('T5 线=', J(R.t5.line && { count: R.t5.line.count, lines: R.t5.line.lines, over: R.t5.line.over }));
R.t6 = await ev(`__DND__.t6(${J(SRC)}, ${J(ROOT)})`);
console.log('T6 dragend 后热点=', R.t6.afterDragEnd.gapCount, 'pointerup 后热点=', R.t6.afterPointerUp.gapCount, '源行卸载后热点=', R.t6.afterUnmount.gapCount, '源标记=', J(R.t6.afterPointerUp.sourceMark));
R.t1cap = await ev(`__DND__.t1cap(${J(TGT)})`);
console.log('T1 封顶(越界', R.t1cap.overshoot, 'px): 每帧最大=', R.t1cap.maxFrameDelta, '最小=', R.t1cap.minFrameDelta, '1.5s 位移=', R.t1cap.delta);
await ev(`__DND__.ensureExpanded(${J(TGT)}, ${J(CHILD)})`);
console.log('T4 前可见夹具行:', J(await ev('Array.from(document.querySelectorAll("[data-tag-path]")).map((e) => e.getAttribute("data-tag-path")).filter((p) => p.startsWith("DND测试"))')));
R.t7 = await ev(`__DND__.t7(${J(SRC)}, ${J(CHILD)})`);
console.log('T7 同父级两半=', J(R.t7.halves.map((x) => ({ half: x.half, over: x.over }))), '| 防抖 hover=', J(R.t7.debounce.hover), '30ms=', J(R.t7.debounce.at30ms), '150ms=', J(R.t7.debounce.at150ms));
R.t8 = await ev(`__DND__.t8(${J(ROOT)})`);
console.log('T8 源在根级: 根级条出现=', R.t8.rootBarDuringDrag, '悬停高亮=', R.t8.hover.rootHighlight, '悬停回执=', J(R.t8.hover.flash), 'drop 回执=', J(R.t8.flashAfterDrop));

// T4:无效目标(自身 / 子孙)与子孙边界带冒泡 —— 后两项带真实落库(只在夹具层内移动)
R.t4.self = await ev(`__DND__.t4(${J(SRC)}, ${J(SRC)})`);
R.t4.descendant = await ev(`__DND__.t4(${J(ROOT)}, ${J(GRAND)})`);
R.t4.bubbleHover = await ev(`__DND__.t4band(${J(CHILD)}, ${J(GRAND)}, 'lower', false)`);
console.log('T4 自身: over=', J(R.t4.self.hover.state.over), 'drop 回执=', J(R.t4.self.after.flash));
console.log('T4 子孙行: over=', J(R.t4.descendant.hover.state.over), 'drop 回执=', J(R.t4.descendant.after.flash));
console.log('T4 子孙边界带(下半): over=', J(R.t4.bubbleHover.hover.over), '线数=', R.t4.bubbleHover.hover.lineCount);
const p0 = await fixtureTags();
R.drops.bubble = await ev(`__DND__.t4band(${J(CHILD)}, ${J(GRAND)}, 'lower', true)`);
await sleep(500);
R.drops.bubble.pathsAfter = await fixtureTags();
console.log('T4 冒泡落库(子 -> DND测试/子):', J(R.drops.bubble.after), '路径=', J(R.drops.bubble.pathsAfter));
R.drops.child = await ev(`__DND__.t4(${J(SRC)}, ${J(TGT)})`);
await sleep(500);
R.drops.child.pathsAfter = await fixtureTags();
console.log('T3/T4 成为子级落库(甲 -> 目标/甲):', J(R.drops.child.after.flash), '路径=', J(R.drops.child.pathsAfter));
R.drops.pathsUnchangedOnInvalid = p0.length > 0 && J(R.t4.self.after.state.over) === 'null';

await call('delete_note', { id: fix.id });
await sleep(900);
const base = new Set(invBefore.paths);
let list = await call('list_tags');
for (const t of list.filter((t) => !base.has(t.path) && (t.path === ROOT || t.path.startsWith(ROOT + '/'))).sort((a, b) => b.depth - a.depth)) {
  await call('delete_tag', { tagId: t.id });
}
await sleep(600);
list = await call('list_tags');
const invAfter = await inventory();
const dbAfter = db();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
R.cleanup = {
  noteId: fix.id,
  leftovers: list.filter((t) => t.path === ROOT || t.path.startsWith(ROOT + '/')).map((t) => t.path),
  dbBefore, dbAfter,
  dbSame: dbBefore.notes === dbAfter.notes && dbBefore.tags === dbAfter.tags && dbBefore.links === dbAfter.links,
  rootsSame: same(dbBefore.roots, dbAfter.roots),
  invSame: same(invBefore.ids, invAfter.ids) && same(invBefore.paths, invAfter.paths) &&
    invBefore.notes === invAfter.notes && invBefore.tabsState === invAfter.tabsState && invBefore.theme === invAfter.theme,
  notes: `${invAfter.notes}/${invBefore.notes}`, tags: `${invAfter.paths.length}/${invBefore.paths.length}`,
};
console.log('收尾:', J(R.cleanup));
mkdirSync(OUT.slice(0, OUT.lastIndexOf('/')), { recursive: true });
writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log('读数已写:', OUT);
close();
