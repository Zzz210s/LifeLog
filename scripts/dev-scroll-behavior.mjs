// 滚动行为验收(主题三:交互副作用)
//   F 节 点正文进编辑时流是否跳动(判定口径:同一个 li 在视口里的 top 是否变 + 流 scrollTop 是否被改)
//   R1 节 焦点在正文框/搜索框时按 PageDown、End —— 整页不得滚动(根 scrollTop 必须恒 0)
//   R5-R8 节 输入栏(见节模块 scripts/dev-scroll-input.mjs):补全列表溢出 / 滚轮交错写回几何键 /
//        按行数增高收回 / 候选列表展开-关闭-隐藏-再显示
// 用法:node scripts/dev-scroll-behavior.mjs [exe路径]   默认 E:/1-LifeLog/LifeLog.exe
// 输出:.superpowers/sdd/2026-09-21-scroll/readings/behavior.json(gitignored)
import { writeFileSync } from 'node:fs';
import { main, install, js, one, findSel, sleep, reloadPage, dump, key } from './dev-scroll-lib.mjs';
import { inputSections } from './dev-scroll-input.mjs';

const OUT = '.superpowers/sdd/2026-09-21-scroll/readings/behavior.json';
const STREAM = `(() => { const el = document.querySelector('.md-body'); return el ? el.closest('div[class*=overflow-y-auto]') : null; })()`;
const R = {};

/** 流 + 第 index 个 li 的几何(视口坐标)与流自身读数 */
const geom = (cdp, index) =>
  js(cdp, `(() => {
    const stream = (${STREAM});
    const lis = Array.from(stream.querySelectorAll('ul > li'));
    const li = lis[${index}];
    const sr = stream.getBoundingClientRect();
    const r = li ? li.getBoundingClientRect() : null;
    return {
      流: { top: Math.round(stream.scrollTop), ch: stream.clientHeight, sh: stream.scrollHeight, 视口top: Math.round(sr.top) },
      根top: Math.round(document.scrollingElement.scrollTop),
      焦点: document.activeElement ? (document.activeElement.getAttribute('aria-label') || document.activeElement.tagName) : null,
      li数: lis.length,
      目标: li ? {
        高: Math.round(r.height), 视口top: Math.round(r.top), 视口bottom: Math.round(r.bottom),
        距流顶: Math.round(r.top - sr.top), 在视口内: r.top >= sr.top && r.bottom <= sr.bottom,
        是编辑面板: !!li.querySelector('textarea[aria-label="编辑源码"]'),
      } : null,
    };
  })()`);

const { cdp, close } = await main();
await install(cdp);
await reloadPage(cdp);
await sleep(500);
const streamSel = await findSel(cdp, STREAM);

/** 一个用例:把流滚到 top,点第 index 张卡片正文,记录前后几何 */
async function caze(name, index, scrollTop) {
  await js(cdp, `(() => { const el = (${STREAM}); el.scrollTop = ${scrollTop}; return true; })()`);
  await sleep(400);
  const before = await geom(cdp, index);
  const clicked = await js(cdp, `(() => {
    const stream = (${STREAM});
    const li = stream.querySelectorAll('ul > li')[${index}];
    const p = li && li.querySelector('.md-body p');
    if (!p) return false;
    p.click();
    return true;
  })()`);
  await sleep(500);
  const after = await geom(cdp, index);
  const out = {
    用例: name, 目标序号: index, 设定流top: scrollTop, 点击成功: clicked,
    前: before, 后: after,
    流top变化: after.流.top - before.流.top,
    卡片视口top变化: before.目标 && after.目标 ? after.目标.视口top - before.目标.视口top : null,
    卡片高变化: before.目标 && after.目标 ? after.目标.高 - before.目标.高 : null,
    已进编辑态: !!(after.目标 && after.目标.是编辑面板),
  };
  // 退出编辑态,恢复原状
  await js(cdp, `(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '取消'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  out.已退出编辑态 = !(await js(cdp, `!!document.querySelector('textarea[aria-label="编辑源码"]')`));
  return out;
}

R.F1_顶部可见卡片 = await caze('流在顶部,点第一张完整可见的卡片(第 2 条)', 1, 0);
R.F2_中段卡片 = await caze('流滚 1200,点视口中段的卡片(第 2 条)', 1, 1200);
R.F3_上缘之外卡片 = await caze('流滚 200,点顶部被裁掉一部分的卡片(第 1 条)', 0, 200);
R.F4_长笔记 = await caze('点第 6 条(正文更长,编辑面板行数更多)', 5, 400);

// F5 机制验证:是 autoFocus 的 scrollIntoView 在动流,而不是 React 重渲染重置 scrollTop
await js(cdp, `(() => { const el = (${STREAM}); el.scrollTop = 0; return true; })()`);
await sleep(400);
await js(cdp, `(() => { const stream = (${STREAM}); const li = stream.querySelectorAll('ul > li')[0]; const p = li.querySelector('.md-body p'); p.click(); return true; })()`);
await sleep(500);
const opened = await geom(cdp, 0);
await js(cdp, `(() => { const el = (${STREAM}); el.scrollTop = 250; return true; })()`);
await sleep(300);
const scrolled = await geom(cdp, 0);
await js(cdp, `(() => { const t = document.querySelector('textarea[aria-label="编辑源码"]'); t.blur(); t.focus(); return true; })()`);
await sleep(400);
const afterFocus = await geom(cdp, 0);
R.F5_机制验证 = { 开编辑后: opened, 手动滚到250: scrolled, blur后再focus: afterFocus, 聚焦引起的流top变化: afterFocus.流.top - scrolled.流.top, 说明: '若变化为负且等于滚动量,则跳动来自焦点元素的 scrollIntoView' };
await js(cdp, `(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '取消'); if (b) b.click(); return true; })()`);
await sleep(400);
R.收尾 = { 编辑态残留: await js(cdp, `!!document.querySelector('textarea[aria-label="编辑源码"]')`), 流: await one(cdp, streamSel), 条数: await js(cdp, `document.querySelectorAll('li .md-body').length`) };
R.库存 = { notes: await js(cdp, `(async () => { const T = window.__TAURI_INTERNALS__.invoke; const C = { keyword: null, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null }; let all = [], off = 0, p; do { p = await T('query_notes', { conditions: C, offset: off }); all = all.concat(p); off += 50; } while (p.length === 50); return all.length; })()`) };

// ---- R1:整页不得滚动(焦点在输入框/搜索框时按 PageDown、End) ----
/** 笔记流的滚动位置 */
const streamTop = (cdp2) => js(cdp2, `(() => { const el = (${STREAM}); return el ? Math.round(el.scrollTop) : null; })()`);
const rootTop = (cdp2) => js(cdp2, `Math.max(document.documentElement.scrollTop, document.body.scrollTop)`);
const topBarTop = (cdp2) => js(cdp2, `Math.round((document.querySelector('header') || document.body).getBoundingClientRect().top)`);
R.R1_整页不滚 = {};
for (const [名字, sel] of [['正文输入框', 'textarea'], ['搜索框', 'input']]) {
  const focused = await js(cdp, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.focus(); return document.activeElement === el; })()`);
  if (!focused) { R.R1_整页不滚[名字] = { 跳过: '找不到可聚焦元素' }; continue; }
  const 前 = { 根top: await rootTop(cdp), 流top: await streamTop(cdp), 顶栏视口y: await topBarTop(cdp) };
  await key(cdp, 'PageDown');
  await sleep(250);
  const 中 = { 根top: await rootTop(cdp), 流top: await streamTop(cdp), 顶栏视口y: await topBarTop(cdp) };
  await key(cdp, 'End');
  await sleep(250);
  const 后 = { 根top: await rootTop(cdp), 流top: await streamTop(cdp), 顶栏视口y: await topBarTop(cdp) };
  R.R1_整页不滚[名字] = { 前, PageDown后: 中, End后: 后, 整页位移: [中.根top - 前.根top, 后.根top - 前.根top], 顶栏位移: [中.顶栏视口y - 前.顶栏视口y, 后.顶栏视口y - 前.顶栏视口y] };
}
// 整页滚走的旧读数(改前实测):根 scrollTop 0->630(PageDown)/0->18929(End),顶栏视口 y 0->-300

// ---- R5-R8:输入栏几何与行为(节模块,几何键收尾自动还原) ----
await inputSections(R, cdp);

writeFileSync(OUT, JSON.stringify(R, null, 2));
dump('F + R1 + 输入栏(R5-R8)', R);
console.log('\n写入', OUT);
close();
