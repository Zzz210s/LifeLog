#!/usr/bin/env node
/**
 * 四项界面调整的真机截图(前缀 entry-,存 .superpowers/shots/):
 *   ① 顶栏常驻「关系图」图标按钮(含悬停提示)  ② 标签右键菜单里直接列出的关系行
 *   ③ 关系图默认视图(共现虚线提亮加粗加长)    ④ 低缩放档(≈0.7)悬停标签时属性名出现
 * **只读**:不动库、不建设置;关系数据取真实库里已有的 `作者/冯骥才 -> 地点/中国大陆(国籍)`。
 * 用法:LIFELOG_CDP_PORT=9333 node scripts/entry-shots.mjs(先起带调试端口的 dev 构建)
 */
import { mkdirSync } from 'node:fs';
import { ensureMain, sleep, waitFor } from './cdp-lib.mjs';
import { bindUi } from './no-tabs-accept-lib.mjs';
import { openTagMenu } from './carry-accept-lib.mjs';
import { setSearch } from './graph-accept-g3-lib.mjs';
import {
  installProbe, probe, markOf, canvasBox, emptyPoint, shot, SHOTS,
} from './relations-demo-lib.mjs';

const SRC = '作者/冯骥才'; // 真库里有 国籍 -> 地点/中国大陆 一条出边
const REMARK = '国籍';
const SH = (n) => `${SHOTS}/entry-${n}.png`;
const log = (...a) => console.log(...a);

mkdirSync(SHOTS, { recursive: true });
const { cdp, target } = await ensureMain();
const ui = bindUi(cdp);
await cdp.send('Page.bringToFront');
const win = await cdp.send('Browser.getWindowForTarget', { targetId: target.id }).catch(() => null);
if (win?.windowId) {
  await cdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { left: 40, top: 20, width: 1480, height: 980, windowState: 'normal' } }).catch(() => null);
  await sleep(1200);
}
await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
await sleep(700);

const files = [];
const rowSel = (p) => `'[data-tag-path=' + JSON.stringify(${JSON.stringify(p)}) + ']'`;

// ① 顶栏常驻关系图按钮 + 悬停提示
const btn = await cdp.eval(`(() => { const b = document.querySelector('[aria-label="关系图"]'); if (!b) return null;
  const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, title: b.title }; })()`);
log(`① 按钮 ${JSON.stringify(btn)}`);
if (btn) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(btn.x + btn.w / 2), y: Math.round(btn.y + btn.h / 2) });
  await sleep(1400);
  files.push(await shot(cdp, SH('1-topbar-button'), { x: Math.max(0, btn.x - 220), y: 0, width: 300, height: 46 }, 2));
}

// ② 标签右键菜单里直接列出关系(先展开「作者」根,再右键源标签)
await waitFor(() => cdp.eval(`!!document.querySelector('aside ' + ${rowSel('作者')})`).catch(() => false), 24, 300);
const srcReady = () => cdp.eval(`!!document.querySelector('aside ' + ${rowSel(SRC)})`).catch(() => false);
if (!(await srcReady())) {
  await cdp.eval(`(() => { const r = document.querySelector('aside ' + ${rowSel('作者')}); const svg = r?.querySelector('svg');
    if (!svg) return false; svg.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
}
await waitFor(srcReady, 20, 250);
await cdp.eval(`(() => { const r = document.querySelector('aside ' + ${rowSel(SRC)}); if (r) r.scrollIntoView({ block: 'center' }); return true; })()`);
await sleep(400);
await openTagMenu(cdp, SRC);
const menuRows = await waitFor(() => cdp.eval(`(() => { const n = document.querySelectorAll('[data-menu-relation]').length;
  return n > 0 ? [...document.querySelectorAll('[data-menu-relation]')].map((el) => el.textContent.trim()) : false; })()`), 12, 250);
log(`② 菜单关系行 ${JSON.stringify(menuRows)}`);
await sleep(300);
files.push(await shot(cdp, SH('2-tag-menu-relations')));
const mrect = await cdp.eval(`(() => { const el = document.querySelector('[data-tag-menu]'); if (!el) return null; const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
if (mrect) files.push(await shot(cdp, SH('2b-tag-menu-crop'), { x: Math.max(0, mrect.x - 8), y: Math.max(0, mrect.y - 8), width: mrect.w + 16, height: mrect.h + 16 }, 2));
await cdp.eval(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
await waitFor(() => cdp.eval(`!document.querySelector('[data-tag-menu]')`), 10, 200);
await sleep(300);

// ③ 用新入口进关系图:默认视图(共现虚线)
await cdp.eval(`(() => { const b = document.querySelector('[aria-label="关系图"]'); if (b) b.click(); return !!b; })()`);
await waitFor(() => cdp.eval(`!!document.querySelector('[data-testid="graph-view"] canvas')`), 30, 300);
await sleep(2600);
files.push(await shot(cdp, SH('3-graph-default')));
const box = await canvasBox(cdp);
if (box) files.push(await shot(cdp, SH('3b-graph-canvas'), { x: box.left, y: box.top, width: box.w, height: box.h }));
await installProbe(cdp);

/** 页面侧滚轮缩放(正数 = 缩小、负数 = 放大);库里的 zoomBy 只会放大 */
const zoom = (n) => cdp.eval(`(async () => { const el = document.querySelector('[data-testid="graph-view"]');
  const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
  for (let i = 0; i < ${Math.abs(n)}; i++) { el.dispatchEvent(new WheelEvent('wheel', { deltaY: ${n > 0 ? 120 : -120}, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    await new Promise((res) => requestAnimationFrame(res)); }
  return true; })()`);
const markCount = async () => ((await probe(cdp))?.texts ?? []).filter((m) => m.t === REMARK).length;
/** 帧指纹:相机夹到 MIN_K(0.5) 后继续缩画面逐帧不变 —— 用它定位「下界已到」 */
const frameHash = (f) => [
  ...(f?.dots ?? []).map((d) => `${Math.round(d.x)},${Math.round(d.y)},${Math.round(d.r)}`),
  '#',
  ...(f?.texts ?? []).map((t) => `${t.t}@${Math.round(t.x)},${Math.round(t.y)}`),
].join('|');

// ④ 低缩放档悬停源标签 -> 属性名出现。缩放档用「相机下界 = 0.5」标定:
//    一路缩小到帧指纹连续两帧不变(夹在 MIN_K=0.5),再放大 2 档 -> k = 0.5 * 1.15^2 = 0.661
await setSearch(cdp, SRC);
await sleep(500);
await cdp.eval(`(() => { const b = document.querySelector('[data-testid="graph-search-item"]'); if (!b) return false;
  b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true; })()`);
await sleep(1000); // 选中 + centerOn:节点落在画布中心
const base = await probe(cdp);
log(`④ 默认档:圆=${(base?.dots ?? []).length} 文字=${(base?.texts ?? []).length}(全标签档 k>1.2)`);
let prev = frameHash(base), same = 0, floorTicks = 0;
for (let i = 1; i <= 30; i++) {
  await zoom(1);
  await sleep(260);
  const h = frameHash(await probe(cdp));
  same = h === prev ? same + 1 : 0;
  prev = h;
  if (same >= 2) { floorTicks = i; break; }
}
log(`④ 缩 ${floorTicks} 档后帧指纹连续不变 -> 已夹在相机下界 k=0.5`);
await zoom(-2);
await sleep(600);
const fr = await probe(cdp);
log(`④ 放大 2 档 -> k = 0.5 * 1.15^2 = 0.661(低于旧阈值 0.8):圆=${(fr?.dots ?? []).length} 文字=${(fr?.texts ?? []).length}(枢纽档 -> 0.6<=k<=1.2)`);
const b2 = await canvasBox(cdp);
// 先点空白清掉选中(否则是「选中」而非「悬停」),再把指针移到节点上
const empty = await emptyPoint(cdp);
if (empty && b2) {
  await cdp.eval(`(() => { const el = document.querySelector('[data-testid="graph-view"] canvas'); const r = el.getBoundingClientRect();
    const mk = (t, x, y) => new MouseEvent(t, { clientX: r.left + x, clientY: r.top + y, bubbles: true });
    el.dispatchEvent(mk('mousedown', ${empty.x}, ${empty.y})); el.dispatchEvent(mk('click', ${empty.x}, ${empty.y})); el.dispatchEvent(mk('mouseup', ${empty.x}, ${empty.y})); return true; })()`);
  await sleep(400);
}
const beforeHover = await markCount();
await cdp.eval(`(() => { const el = document.querySelector('[data-testid="graph-view"] canvas'); const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, pointerId: 7, pointerType: 'mouse', isPrimary: true })); return true; })()`);
await sleep(700);
const mark = await markOf(cdp, REMARK);
log(`④ 悬停中心节点:备注「${REMARK}」条数 ${beforeHover} -> ${await markCount()}@(${mark ? Math.round(mark.x) + ',' + Math.round(mark.y) : 'n/a'})`);
files.push(await shot(cdp, SH('4-hover-remark-lowzoom')));
if (box && mark) files.push(await shot(cdp, SH('4b-hover-crop'), { x: box.left + Math.max(0, mark.x - 160), y: box.top + Math.max(0, mark.y - 80), width: 320, height: 160 }, 2));
log(`\n截图 ${files.map((f) => f.replace(/\\/g, '/')).join(' , ')}`);
await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
await sleep(300);
process.exit(0);
