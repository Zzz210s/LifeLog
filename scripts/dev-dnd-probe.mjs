#!/usr/bin/env node
/**
 * 「标签拖拽不可行」诊断探针(只测不改):D1-D7 逐项取证。
 * 被测:安装版 E:/1-LifeLog/LifeLog.exe(9222 CDP);拖拽一律页面内合成 DragEvent,**不碰 OS 鼠标**
 * (因此拖拽图像 / 原生 dragstart 需 OS 拖动回路的部分测不到,见报告「没测到的项」)。
 * 真实库只读;夹具 DND测试* 自建自删,收尾给库存前后逐项对照(含只读 sqlite 计数)。
 * 用法:node scripts/dev-dnd-probe.mjs   产物:.superpowers/sdd/2026-09-21-dnd/readings/dnd-before.json
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ensureMain, sleep, waitFor, bindMain } from './cdp-lib.mjs';

const OUT = '.superpowers/sdd/2026-09-21-dnd/readings/dnd-before.json';
const ROOT = 'DND测试';
const SRC = `${ROOT}/源`;
const TGT = `${ROOT}/目标`;
const CHILD = `${TGT}/子`;
const NOTE = `#${SRC} #${CHILD} DND夹具`;
const DB = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
const SQL = `import json,sqlite3
c=sqlite3.connect('file:${DB}?mode=ro',uri=True)
print(json.dumps({'notes':c.execute('select count(*) from notes').fetchone()[0],
'tags':c.execute('select count(*) from tags').fetchone()[0],
'links':c.execute('select count(*) from tag_links').fetchone()[0],
'roots':c.execute('select path,sort_order from tags where parent_id is null order by path').fetchall(),
'sidecar':c.execute("select path from tags where path like 'DND测试%'").fetchall()}))`;
const db = () => JSON.parse(execFileSync('python', ['-c', SQL], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }).toString());

/** 页面内探针命名空间:__DND__(合成 DragEvent + DOM 读数) */
const PAGE = `window.__DND__ = (() => {
  let DT = new DataTransfer();
  const q = (s) => document.querySelector(s);
  const row = (p) => q('[data-tag-path="' + p + '"]');
  const tick = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 80 : ms));
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: +r.top.toFixed(1), left: +r.left.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1) }; };
  const kind = (el) => { if (!el) return null; const o = (el.closest && el.closest('[data-gap-anchor],[data-tag-path],[data-testid]')) || el;
    return { tag: el.tagName.toLowerCase(), ownerTag: o.tagName.toLowerCase(), testid: o.getAttribute('data-testid'), path: o.getAttribute('data-tag-path'), gap: o.getAttribute('data-gap-anchor') ? o.getAttribute('data-gap-anchor') + ':' + o.getAttribute('data-gap-zone') : null }; };
  const fire = (el, type, x, y) => { const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: DT, clientX: x, clientY: y }); el.dispatchEvent(ev); return ev.defaultPrevented; };
  const state = () => { const g = q('[data-gap-active="true"]'); const t = q('[data-drop-target]'); const bar = q('[data-testid="tag-root-drop"]'); const src = q('[data-drag-source="true"]');
    const line = q('[data-gap-active="true"] span, [data-drop-target] span');
    return { gapActive: g ? { anchor: g.getAttribute('data-gap-anchor'), zone: g.getAttribute('data-gap-zone') } : null,
      rowTarget: t ? { path: t.getAttribute('data-tag-path'), zone: t.getAttribute('data-drop-target') } : null,
      gapCount: document.querySelectorAll('[data-gap-anchor]').length, rootBar: !!bar,
      rootHighlight: !!bar && String(bar.className).includes('border-accent'),
      sourceMark: src ? src.getAttribute('data-tag-path') : null,
      dropEffect: DT.dropEffect, effectAllowed: DT.effectAllowed,
      flash: q('[data-testid="tag-flash"]') ? q('[data-testid="tag-flash"]').textContent.trim() : null,
      line: line ? { ...box(line), bg: getComputedStyle(line).backgroundColor } : null }; };
  const start = async (p) => { DT = new DataTransfer(); const el = row(p); const r = box(el);
    const prevented = fire(el, 'dragstart', r.left + r.width / 2, r.top + r.height / 2); await tick(); return { prevented, box: r }; };
  const hover = async (el, x, y) => { const prevented = fire(el, 'dragover', x, y); await tick(); return { hit: kind(el), prevented, state: state() }; };
  const end = async () => { const s = q('[data-drag-source="true"]'); if (s) { const r = box(s); fire(s, 'dragend', r.left + 2, r.top + 2); } await tick(120); return state(); };
  return {
    box, row, state, kind, tick, start, end,
    /** 夹具幂等:TGT 折叠时点箭头展开(上一轮可能已把它折叠),返回子行是否可见 */
    ensureExpanded: async (p, child) => { const el = row(p); if (!el) return false; if (row(child)) return true;
      const svg = el.querySelector('svg'); if (svg) svg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await tick(250); return !!row(child); },
    /** 对照实验:合成 DataTransfer 上 effectAllowed / dropEffect 的赋值能否回读 */
    dt: () => { const d = new DataTransfer(); d.effectAllowed = 'move'; d.dropEffect = 'move'; return { effectAllowed: d.effectAllowed, dropEffect: d.dropEffect, types: d.types.length }; },
    /** D1:派发 dragstart,读 React 拖拽态与源行视觉前后值 */
    d1: async (p) => { await end(); const el = row(p); const cs = getComputedStyle(el);
      const pre = { opacity: cs.opacity, background: cs.backgroundColor, outline: cs.outlineStyle, draggable: el.getAttribute('draggable'), gaps: document.querySelectorAll('[data-gap-anchor]').length, rootBar: !!q('[data-testid="tag-root-drop"]') };
      const ds = await start(p); await tick(150); const el2 = row(p); const cs2 = getComputedStyle(el2);
      const post = { ...state(), opacity: cs2.opacity, background: cs2.backgroundColor, outline: cs2.outlineStyle,
        sourceAttr: el2.getAttribute('data-drag-source'), sourceBox: box(el2), flash: undefined };
      return { pre, dragstartPrevented: ds.prevented, post }; },
    /** D2:命中测试(真实指针路径)+ 直投行元素(绕过命中)+ 1px 分辨率命中图 */
    d2: async (p, ratios) => { const el = row(p); el.scrollIntoView({ block: 'center' }); await tick(120);
      const r = box(el); const out = { rowBox: r, byRatio: [], direct: [], scan: [] };
      for (const ratio of ratios) { const x = r.left + r.width / 2; const y = r.top + r.height * ratio; const dy = +((y - r.top).toFixed(1));
        out.byRatio.push({ ratio, dy, ...(await hover(document.elementFromPoint(x, y) || el, x, y)) });
        out.direct.push({ ratio, dy, ...(await hover(el, x, y)) }); }
      const x = r.left + r.width / 2;
      for (let dy = -18; dy <= r.height + 18; dy += 2) { const y = r.top + dy; const hit = document.elementFromPoint(x, y);
        const res = await hover(hit || el, x, y);
        out.scan.push({ dy, hitTag: res.hit && res.hit.tag, hitPath: res.hit && res.hit.path, hitGap: res.hit && res.hit.gap, over: res.state.rowTarget || res.state.gapActive, effect: res.state.dropEffect }); }
      return out; },
    /** D3:无效目标的 hover 与 drop 反馈(自身 / 子孙) */
    d3: async (from, to) => { await start(from); const el = row(to); const r = box(el);
      const hv = await hover(el, r.left + r.width / 2, r.top + r.height / 2);
      const hoverHint = !!q('[data-testid="tag-flash"]');
      const prevented = fire(el, 'drop', r.left + r.width / 2, r.top + r.height / 2); await tick(250);
      const out = { hover: hv, hoverHintElement: hoverHint, dropPrevented: prevented, stateAfterDrop: state() };
      await end(); return out; },
    /** D4:边缘悬停 1.5s(50ms x 30 次),读 scrollTop 位移 */
    d4: async (dir, src) => { if (src) await start(src); const list = q('[data-testid="tag-list"]');
      list.scrollTop = dir === 'bottom' ? list.scrollHeight : 0; await tick(150); const r = box(list);
      const y = dir === 'bottom' ? r.bottom - 12 : r.top + 6; const x = r.left + r.width / 2;
      const hit = document.elementFromPoint(x, y); const before = list.scrollTop; let prevented = 0;
      for (let i = 0; i < 30; i++) { const el = document.elementFromPoint(x, y) || hit; const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: DT, clientX: x, clientY: y }); el.dispatchEvent(ev); if (ev.defaultPrevented) prevented++; await tick(50); }
      await tick(200);
      return { dir, y: +y.toFixed(1), listBox: r, hit: kind(hit), prevented, before, after: list.scrollTop, delta: list.scrollTop - before,
        scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, overflows: list.scrollHeight > list.clientHeight + 4 }; },
    /** D5:折叠有子级的节点后,中部悬停 1.2s,看是否自动展开 */
    d5: async (p, child, src) => { const el = row(p); const svg = el.querySelector('svg');
      if (row(child) && svg) { svg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await tick(150); }
      const collapsed = !row(child);
      await start(src);
      const r = box(row(p)); let seen = null; const x = r.left + r.width / 2; const y = r.top + r.height / 2;
      for (let i = 0; i < 24; i++) { const el2 = row(p) || el; const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: DT, clientX: x, clientY: y }); el2.dispatchEvent(ev); if (i === 2) seen = state(); await tick(50); }
      await tick(150); const out = { collapsed, sawExpanded: !!row(child), stateDuringHover: seen, stateAfter: state() };
      await end(); const svg2 = (row(p) || el).querySelector('svg');
      if (svg2) svg2.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await tick(200);
      out.restoredExpanded = !!row(child); return out; },
    /** D6:视觉清单(computed style / 尺寸) */
    d6: async (p, srcPath, other) => { const out = {}; await start(srcPath);
      const el = row(p); const r = box(el); const cx = r.left + r.width / 2;
      await hover(el, cx, r.top + r.height / 2); out.childState = state();
      const el2 = row(p); const cs = getComputedStyle(el2);
      out.childRow = { path: p, box: box(el2), boxShadow: cs.boxShadow, background: cs.backgroundColor, borderRadius: cs.borderRadius, paddingLeft: cs.paddingLeft };
      const o = row(other); out.plainRow = o ? { path: other, background: getComputedStyle(o).backgroundColor, boxShadow: getComputedStyle(o).boxShadow } : null;
      const s = row(srcPath); const cs3 = getComputedStyle(s); out.sourceRow = { path: srcPath, opacity: cs3.opacity, background: cs3.backgroundColor, boxShadow: cs3.boxShadow, box: box(s) };
      await hover(el, cx, r.top + r.height * 0.1); out.rowLineState = state();
      const gap = q('[data-gap-anchor="' + p + '"][data-gap-zone="before"]');
      if (gap) { const gb = box(gap); await hover(gap, gb.left + gb.width / 2, gb.top + gb.height / 2); out.gapState = state(); }
      out.gapCountWhileDragging = document.querySelectorAll('[data-gap-anchor]').length;
      const ag = q('[data-gap-active="true"]');
      if (ag) { const gs = getComputedStyle(ag); const anchor = row(ag.getAttribute('data-gap-anchor'));
        out.gapZone = { box: box(ag), height: gs.height, marginTop: gs.marginTop, marginBottom: gs.marginBottom, position: gs.position, zIndex: gs.zIndex };
        const line = ag.querySelector('span'); if (line) { const ls = getComputedStyle(line); out.gapLine = { box: box(line), height: ls.height, background: ls.backgroundColor, anchorBox: box(anchor), leftOffsetFromAnchor: +(box(line).left - box(anchor).left).toFixed(1), anchorPaddingLeft: getComputedStyle(anchor).paddingLeft, anchorDepth: ag.getAttribute('data-gap-anchor').split('/').length }; } }      const rowLine = q('[data-drop-target] span'); if (rowLine) { const ls2 = getComputedStyle(rowLine); const a2 = q('[data-drop-target]'); out.rowLine = { box: box(rowLine), height: ls2.height, background: ls2.backgroundColor, rowBox: box(a2), leftOffsetFromRow: +(box(rowLine).left - box(a2).left).toFixed(1) }; }
      const bar = q('[data-testid="tag-root-drop"]'); out.rootBar = bar ? { box: box(bar), cls: String(bar.className).slice(0, 150), background: getComputedStyle(bar).backgroundColor, borderStyle: getComputedStyle(bar).borderStyle } : null;
      await end(); await tick(150);
      out.gapCountAfterDragEnd = document.querySelectorAll('[data-gap-anchor]').length;
      out.rootBarAfterDragEnd = !!q('[data-testid="tag-root-drop"]');
      return out; },
    /** D7:分区空白(容器内边距)与根级条的 hover/drop */
    d7: async (rootPath) => { const list = q('[data-testid="tag-list"]'); list.scrollTop = list.scrollHeight; await tick(150);
      await start(rootPath);
      const r = box(list); /* start 后重取:根级条出现会挤矮列表 */
      const bx = r.left + 2, by = r.top + r.height * 0.4; const blankHit = document.elementFromPoint(bx, by);
      const blank = await hover(blankHit || list, bx, by);
      if (blankHit) fire(blankHit, 'drop', bx, by); await tick(700); const blankDrop = state();
      await start(rootPath); /* 空白落手会结束拖拽态,重新开始 */
      const bar = q('[data-testid="tag-root-drop"]'); const bb = bar ? box(bar) : null;
      const bcx = bb ? bb.left + bb.width / 2 : bx, bcy = bb ? bb.top + bb.height / 2 : by + 20;
      const onBar = await hover(bar || list, bcx, bcy);
      const flashBefore = state().flash;
      if (bar) { fire(bar, 'drop', bcx, bcy); } await tick(600);
      const out = { listBox: r, blankHit: kind(blankHit), blank, blankDrop, barBox: bb, onBar, flashBeforeDrop: flashBefore, stateAfterDrop: state() };
      await end(); return out; },
  };
})(); 'ok'`;

const { cdp, close } = await ensureMain();
const { call, inventory, paths } = bindMain(cdp);
const R = { meta: {}, d1: null, d2: null, d6: null, d3: {}, d5: null, d7: null, d4: {}, cleanup: {} };const ev = (expr) => cdp.eval(`(async () => { ${PAGE}; return await ${expr}; })()`);
console.log('页面探针注入:', await ev('__DND__.state()') ? 'ok' : 'fail');
const dbBefore = db(); const invBefore = await inventory();
// 先清上一轮残留夹具(崩溃重跑):本脚本的任何删除都只针对夹具笔记/DND测试子树
const stale = await call('query_notes', { conditions: { keyword: 'DND夹具', tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null }, offset: 0 }); for (const n of stale) await call('delete_note', { id: n.id });
if (stale.length) console.log('清掉上一轮残留夹具笔记:', stale.map((n) => n.id).join(','));
R.meta = { dbBefore, notes: invBefore.notes, tagPaths: invBefore.paths.length, tabsState: invBefore.tabsState, theme: invBefore.theme,
  listGeometry: await ev('({ box: __DND__.box(document.querySelector(\'[data-testid="tag-list"]\')), rows: document.querySelectorAll("[data-tag-path]").length, scrollTop: document.querySelector(\'[data-testid="tag-list"]\').scrollTop, scrollHeight: document.querySelector(\'[data-testid="tag-list"]\').scrollHeight })') };
console.log('库存基线 notes=', dbBefore.notes, 'tags=', dbBefore.tags, 'links=', dbBefore.links, '| IPC tags=', invBefore.paths.length);

// 夹具:1 条笔记带 4 个标签(源 / 目标 / 目标/子)
const fix = await call('save_input_note', { content: NOTE });
const ready = await waitFor(() => ev(`__DND__.ensureExpanded(${JSON.stringify(TGT)}, ${JSON.stringify(CHILD)})`), 20, 300);
console.log('夹具就位:', !!ready, 'noteId=', fix && fix.id, 'tags=', (await paths()).filter((p) => p.startsWith(ROOT)).join(' , '));

R.d1 = await ev(`__DND__.d1(${JSON.stringify(SRC)})`);
console.log('D1 拖动源标记=', R.d1.post.sourceMark, 'opacity=', R.d1.post.opacity, '热区数=', R.d1.post.gapCount, 'effectAllowed=', R.d1.post.effectAllowed);
R.d2 = await ev(`__DND__.d2(${JSON.stringify(TGT)}, [0.1, 0.35, 0.6, 0.9])`);
console.log('D2 命中:', JSON.stringify(R.d2.byRatio.map((b) => ({ r: b.ratio, hit: b.hit.path || b.hit.gap || b.hit.tag, over: b.state.rowTarget || b.state.gapActive, eff: b.state.dropEffect }))));
R.d6 = await ev(`__DND__.d6(${JSON.stringify(TGT)}, ${JSON.stringify(SRC)}, ${JSON.stringify(ROOT)})`);
for (const [name, from, to] of [['self', SRC, SRC], ['descendant', TGT, CHILD]]) {
  const p0 = await paths();
  R.d3[name] = await ev(`__DND__.d3(${JSON.stringify(from)}, ${JSON.stringify(to)})`);
  const p1 = await paths();
  R.d3[name].pathsUnchanged = JSON.stringify(p0) === JSON.stringify(p1);
  console.log('D3', name, JSON.stringify({ over: R.d3[name].hover.state.rowTarget || R.d3[name].hover.state.gapActive, eff: R.d3[name].hover.state.dropEffect, flash: R.d3[name].stateAfterDrop.flash, pathsUnchanged: R.d3[name].pathsUnchanged }));
  await sleep(3200);
}
R.d5 = await ev(`__DND__.d5(${JSON.stringify(TGT)}, ${JSON.stringify(CHILD)}, ${JSON.stringify(SRC)})`);
console.log('D5 折叠=', R.d5.collapsed, '1.2s 后展开=', R.d5.sawExpanded);
R.d7 = await ev(`__DND__.d7(${JSON.stringify(ROOT)})`);
console.log('D7 空白命中=', JSON.stringify(R.d7.blankHit && (R.d7.blankHit.testid || R.d7.blankHit.tag)), 'root=', R.d7.blank.state.rootHighlight, '| 空白 drop 回执=', R.d7.blankDrop.flash, '| 根级条 hover root=', R.d7.onBar.state.rootHighlight, '| 根级条 drop 回执=', R.d7.stateAfterDrop.flash);
for (const dir of ['bottom', 'top']) { R.d4[dir] = await ev(`__DND__.d4(${JSON.stringify(dir)}, ${JSON.stringify(SRC)})`);
  console.log('D4', dir, 'scrollTop', R.d4[dir].before, '->', R.d4[dir].after, 'delta=', R.d4[dir].delta, 'hit=', R.d4[dir].hit && (R.d4[dir].hit.path || R.d4[dir].hit.gap || R.d4[dir].hit.testid || R.d4[dir].hit.tag)); }
R.meta.d4Floating = await ev(`(async () => { await __DND__.start(${JSON.stringify(SRC)}); const a = await __DND__.d4('bottom'); const b = await __DND__.d4('top'); await __DND__.end(); return { bottom: a.delta, top: b.delta }; })()`);
console.log('D4 连测(同一拖拽态):', JSON.stringify(R.meta.d4Floating));
R.meta.dtControl = await ev('__DND__.dt()');
console.log('合成 DataTransfer 对照(赋值能否回读):', JSON.stringify(R.meta.dtControl));
// 收尾:删夹具笔记(笔记删空后容器标签会被 GC) + 删净 DND测试 残留节点
await call('delete_note', { id: fix.id }); await sleep(900);
const base = new Set(invBefore.paths); let list = await call('list_tags');
for (const t of list.filter((t) => !base.has(t.path) && (t.path === ROOT || t.path.startsWith(ROOT + '/'))).sort((a, b) => b.depth - a.depth)) await call('delete_tag', { tagId: t.id });
await sleep(600); list = await call('list_tags');
const invAfter = await inventory(); const dbAfter = db();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
R.cleanup = { noteId: fix.id, leftovers: list.filter((t) => t.path === ROOT || t.path.startsWith(ROOT + '/')).map((t) => t.path),
  invSame: same(invBefore.ids, invAfter.ids) && same(invBefore.paths, invAfter.paths) && invBefore.notes === invAfter.notes && invBefore.tabsState === invAfter.tabsState && invBefore.theme === invAfter.theme,
  dbBefore, dbAfter, dbSame: dbBefore.notes === dbAfter.notes && dbBefore.tags === dbAfter.tags && dbBefore.links === dbAfter.links && same(dbBefore.roots, dbAfter.roots),
  notes: `${invAfter.notes}/${invBefore.notes}`, tags: `${invAfter.paths.length}/${invBefore.paths.length}` };
console.log('收尾:', JSON.stringify(R.cleanup));
mkdirSync(OUT.slice(0, OUT.lastIndexOf('/')), { recursive: true });
writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log('读数已写:', OUT);
close();
