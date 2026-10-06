#!/usr/bin/env node
/**
 * 本轮打磨的真机截图(5 张,前缀 polish-):
 *   ① 关系图默认视图(只有箭头、无属性名)  ② 悬停/选中一个标签(属性名出现 + 同轴亮)
 *   ③ 侧栏行内值带底衬(chip)              ④ 悬停一个有关系的标签(简化卡片:末段名 + 关系行)
 *   ⑤ 悬停一个没有关系的标签(无卡片)
 * 只驱动真实 UI(统一输入框 / 合成 pointer 事件),页面侧不写测试钩子。
 * 用法:LIFELOG_CDP_PORT=9333 node scripts/polish-shots.mjs
 */
import { writeFileSync } from 'node:fs';
import { ensureMain, sleep } from './cdp-lib.mjs';
import { bindUi } from './no-tabs-accept-lib.mjs';
import { armGraph, closeGraph } from './graph-accept-lib.mjs';

const OUT = '.superpowers/shots';
const shot = async (cdp, name, clip, scale = 1) => {
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    ...(clip ? { clip: { ...clip, scale } } : {}),
  });
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log(`  存 ${file}${clip ? ` clip=${JSON.stringify(clip)} scale=${scale}` : ''}`);
};

const { cdp } = await ensureMain();
const ui = bindUi(cdp);
await cdp.send('Page.bringToFront');

// 回到信息流(关系图可能开着)
await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
await sleep(800);

/** 侧栏可见标签行的读数 */
const rowsOf = () =>
  cdp.eval(`(() => [...document.querySelectorAll('aside [data-tag-path]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { path: el.getAttribute('data-tag-path'), hasCard: el.hasAttribute('data-tip-rows'),
      chips: el.querySelectorAll('[data-tag-relation]').length,
      y: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) };
  }))()`);

/** 把某一行滚到视口中间并返回它的当前矩形 */
const focusRow = (path) =>
  cdp.eval(`(() => { const el = document.querySelector('aside [data-tag-path=' + JSON.stringify(${JSON.stringify(path)}) + ']');
    if (!el) return null; el.scrollIntoView({ block: 'center' }); return true; })()`);

const rectOf = (path) =>
  cdp.eval(`(() => { const el = document.querySelector('aside [data-tag-path=' + JSON.stringify(${JSON.stringify(path)}) + ']');
    if (!el) return null; const r = el.getBoundingClientRect();
    return { x: r.left - 4, y: r.top - 8, width: r.width + 8, height: r.height + 18 }; })()`);

const hoverRow = (path) =>
  cdp.eval(`(() => { const el = document.querySelector('aside [data-tag-path=' + JSON.stringify(${JSON.stringify(path)}) + ']');
    if (!el) return false; el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return true; })()`);

/** 离开某一行(真实鼠标移开时会发 mouseout,HoverTip 靠它收起气泡) */
const unhoverRow = (path) =>
  cdp.eval(`(() => { const el = document.querySelector('aside [data-tag-path=' + JSON.stringify(${JSON.stringify(path)}) + ']');
    if (!el) return false; el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); return true; })()`);

const bubble = () =>
  cdp.eval(`(() => { const b = document.querySelector('[data-testid="hover-tip"]');
    return b === null ? null : { text: b.textContent, rows: b.querySelectorAll('[data-tip-row-label]').length }; })()`);

// ---- ③ 侧栏行内值底衬:挑一个「有关系 + 行内带 chip」的可见行,不悬停 ----
const all = await rowsOf();
const withChip = all.find((r) => r.hasCard && r.chips > 0 && r.y > 0 && r.y < 640);
if (!withChip) throw new Error('侧栏里找不到「有关系+带 chip」的可见行');
console.log(`③ 用行 ${withChip.path}(chip=${withChip.chips})`);
await focusRow(withChip.path);
await sleep(500);
const chipRect = await rectOf(withChip.path);
await shot(cdp, 'polish-sidebar-chip', chipRect, 2);

// ---- ④ 悬停一个有关系的标签:简化卡片 ----
await hoverRow(withChip.path);
await sleep(400);
console.log(`④ 卡片读数 ${JSON.stringify(await bubble())}`);
await shot(cdp, 'polish-hover-card');

// ---- ⑤ 悬停一个没有关系的标签:不出卡片 ----
const noCard = (await rowsOf()).find((r) => !r.hasCard && r.y > 0 && r.y < 640);
if (!noCard) throw new Error('侧栏里找不到「无关系」的可见行');
console.log(`⑤ 用行 ${noCard.path}`);
await unhoverRow(withChip.path); // 先离开上一行,HoverTip 才会收起旧卡片
await sleep(250);
await focusRow(noCard.path);
await sleep(400);
await hoverRow(noCard.path);
await sleep(400);
const none = await bubble();
console.log(`⑤ 卡片读数 ${JSON.stringify(none)}(应为 null)`);
await shot(cdp, 'polish-hover-no-card');

// ---- ① 关系图默认视图:只有箭头、无属性名 ----
await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); // 清掉 hover
await sleep(300);
await closeGraph(ui);
await sleep(300);
await armGraph(ui);
await sleep(1600);
console.log(`① 图上备注胶囊数 = ${await cdp.eval('window.__g3 ? window.__g3.cur.labels.filter((t) => !/^[0-9+]+$/.test(t)).length : -1')}(注:文字总数,非备注专用)`);
await shot(cdp, 'polish-graph-default');

// ---- ② 图内搜索定位一个「有关系」的标签 -> 选中/悬停,属性名出现 ----
const target = withChip.path;
const setSearch = (v) =>
  cdp.eval(`(() => { const b = document.querySelector('[data-testid="graph-search-input"]'); if (!b) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(b, ${JSON.stringify(v)});
    b.dispatchEvent(new Event('input', { bubbles: true })); b.focus(); return true; })()`);
await setSearch(target);
await sleep(500);
const picked = await cdp.eval(`(() => { const it = document.querySelector('[data-testid="graph-search-item"]'); if (!it) return null;
  const t = it.textContent; it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return t; })()`);
console.log(`② 搜索命中 ${JSON.stringify(picked)}`);
await sleep(700);
// 选中之后节点被居中;再补一次真实悬停(视口坐标 = 画布中心 + 容器原点)
await cdp.eval(`(() => { const el = document.querySelector('[data-testid="graph-view"]'); const c = el.querySelector('canvas');
  const r = c.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
  el.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerId: 3, pointerType: 'mouse', isPrimary: true }));
  return true; })()`);
await sleep(700);
console.log(`② 图上卡片 = ${JSON.stringify(await cdp.eval(`(() => { const b = document.querySelector('[data-testid="hover-tip"]'); return b === null ? null : b.textContent; })()`))}`);
await shot(cdp, 'polish-graph-hover');

await closeGraph(ui);
console.log('全部截图完成');
process.exit(0);
