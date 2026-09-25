// 滚动优化验收(主题二:交互正确性)
//   C1 补 流滚到最底时的链式滚动(根是否被带走)
//   C5 输入栏:输入框上滚是否缩放、补全列表上滚是否被缩放吞掉
//   C6 编辑面板 textarea 独立滚动 + 根滚动的可见后果(顶栏是否被带走)
//   A3 小视口(Emulation 页面级 400x300)下表达式/标签两个弹层是否被裁、关键按钮是否可达
// 注:C7「切筛选后的流向位置」已作废(切页入口随多页筛选一并删除,
// 排序按钮也已从条件栏搬进顶栏 ⋯ 菜单),整段读数一并删掉。
// 输入全部走 CDP 合成(滚轮/键盘/指针)与页面内 DOM 动作,不用 OS 鼠标;仅 Emulation 改页面级视口。
// 用法:node scripts/dev-scroll-interaction.mjs [exe路径]   默认 E:/1-LifeLog/LifeLog.exe
// 输出:.superpowers/sdd/2026-09-21-scroll/readings/interaction.json(gitignored)
// 前置:单实例应用 —— 脚本不自行拉起,先按 dev-scroll-geometry.mjs 的方式在 9222 上启动。
import { writeFileSync } from 'node:fs';
import { main, install, js, one, findSel, rect, wheel, sleep, reloadPage, dump, input as openInput } from './dev-scroll-lib.mjs';
import { dialogSections } from './dev-scroll-dialogs.mjs';

const OUT = '.superpowers/sdd/2026-09-21-scroll/readings/interaction.json';
const R = {};
const STREAM = `(() => { const el = document.querySelector('.md-body'); return el ? el.closest('div[class*=overflow-y-auto]') : null; })()`;
const call = (cdp, cmd, args = {}) =>
  js(cdp, `(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const streamTop = (cdp) => js(cdp, `(() => { const el = (${STREAM}); return el ? Math.round(el.scrollTop) : null; })()`);
const clickByText = (cdp, prefix) =>
  js(cdp, `(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim().startsWith(${JSON.stringify(prefix)})); if (!b) return false; b.click(); return true; })()`);

const { cdp, close } = await main();
await install(cdp);
await reloadPage(cdp);
await sleep(400);

// ---- C1 补测:流滚到最底时的链式滚动(根是否被带走) ----
const streamSel = await findSel(cdp, STREAM);
const sRect = await rect(cdp, streamSel);
const SP = { x: Math.round(sRect.x + sRect.w / 2), y: Math.round(sRect.y + sRect.h * 0.4) };
const snap = () => js(cdp, `(() => { const el = (${STREAM}); return { 流top: Math.round(el.scrollTop), 流max: el.scrollHeight - el.clientHeight, 根top: Math.round(document.scrollingElement.scrollTop), 条数: document.querySelectorAll('li .md-body').length }; })()`);
await js(cdp, `(() => { const el = document.querySelector(${JSON.stringify(streamSel)}); el.scrollTop = el.scrollHeight; return true; })()`);
await sleep(1200); // 等新一页渲染完
const c1a = await snap();
await js(cdp, `(() => { const el = document.querySelector(${JSON.stringify(streamSel)}); el.scrollTop = el.scrollHeight; return true; })()`);
await wheel(cdp, SP.x, SP.y, 800);
await sleep(60);
await wheel(cdp, SP.x, SP.y, 800);
await sleep(500);
const c1b = await snap();
R.C1补_最底链式 = { 到底后: c1a, 到底后立即连滚两次: c1b, 根是否被带动: c1b.根top > 0 };
await js(cdp, `document.scrollingElement.scrollTop = 0`);

// ---- C5 输入栏滚轮:缩放 vs 列表滚动 ----
await call(cdp, 'show_input_bar');
await sleep(1500);
const zoomOf = async (icdp) => Number(await call(icdp, 'get_setting', { key: 'input_zoom' }));
const { cdp: icdp, close: iclose } = await openInput();
await install(icdp);
await sleep(500);
const zoomBefore = await zoomOf(icdp);
const taSel = await findSel(icdp, `document.querySelector('textarea[aria-label="输入栏内容"]')`);
const taRect = await rect(icdp, taSel);
const tap = { x: Math.round(taRect.x + taRect.w / 2), y: Math.round(taRect.y + taRect.h / 2) };
await js(icdp, `(() => { const el = document.querySelector(${JSON.stringify(taSel)}); el.focus(); return true; })()`);
await wheel(icdp, tap.x, tap.y, -120);
await sleep(900);
const zoomAfterTa = await zoomOf(icdp);
R.C5_输入框上滚 = { 落点: tap, zoom前: zoomBefore, zoom后: zoomAfterTa, 判定: zoomAfterTa !== zoomBefore ? '缩放发生变化' : '缩放未变' };
// 恢复缩放
await call(icdp, 'set_input_scale', { zoom: 1 });
await sleep(900);
R.C5_恢复后zoom = await zoomOf(icdp);
// 打开 # 补全列表(8 条上限 = 列表正好占满自身最大高度)
await js(icdp, `(() => { const el = document.querySelector(${JSON.stringify(taSel)}); window.__probe.setValue(el, '#'); return true; })()`);
await sleep(1200);
const listSel = await findSel(icdp, `document.querySelector('[data-testid="tag-suggest"]')`);
const listRect = listSel ? await rect(icdp, listSel) : null;
const listInfo = listSel ? await one(icdp, listSel) : null;
const lp = listRect ? { x: Math.round(listRect.x + listRect.w / 2), y: Math.round(listRect.y + Math.min(30, listRect.h / 2)) } : null;
const zoomBeforeList = await zoomOf(icdp);
const listTopBefore = listSel ? await js(icdp, `document.querySelector(${JSON.stringify(listSel)}).scrollTop`) : null;
if (lp) {
  await wheel(icdp, lp.x, lp.y, -120);
  await sleep(900);
}
const zoomAfterList = await zoomOf(icdp);
const listTopAfter = listSel ? await js(icdp, `document.querySelector(${JSON.stringify(listSel)}).scrollTop`) : null;
R.C5_补全列表上滚 = {
  列表选择器: listSel, 落点: lp,
  列表读数: listInfo && { cw: listInfo.cw, ch: listInfo.ch, sh: listInfo.sh, oy: listInfo.oy, barW: listInfo.barW },
  候选条数: await js(icdp, `document.querySelectorAll('[data-testid="tag-suggest"] [role="option"]').length`),
  列表scrollTop: { 前: listTopBefore, 后: listTopAfter },
  zoom前: zoomBeforeList, zoom后: zoomAfterList,
  判定: zoomAfterList !== zoomBeforeList ? '滚列表变成了缩放输入栏' : '缩放未变',
};
// 收尾:清空输入栏内容、恢复缩放并隐藏
await js(icdp, `(() => { window.__probe.setValue(document.querySelector(${JSON.stringify(taSel)}), ''); return true; })()`);
await call(icdp, 'set_input_scale', { zoom: 1 });
await sleep(600);
await call(icdp, 'hide_input_bar');
await sleep(800);
R.C5_收尾zoom = await zoomOf(icdp);
iclose();

// ---- C6 编辑面板 textarea:自己滚,且与流互不干扰 ----
await js(cdp, `document.querySelector('li .md-body p')?.click()`);
await sleep(600);
const edSel = await findSel(cdp, `document.querySelector('textarea[aria-label="编辑源码"]')`);
const longSrc = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行内容`).join('\n');
await js(cdp, `(() => { const el = document.querySelector(${JSON.stringify(edSel)}); window.__probe.setValue(el, ${JSON.stringify(longSrc)}); return true; })()`);
await sleep(500);
const edInfo = await one(cdp, edSel);
const edRect = await rect(cdp, edSel);
const ep = { x: Math.round(edRect.x + edRect.w / 2), y: Math.round(edRect.y + edRect.h / 2) };
const before6 = { 编辑框top: await js(cdp, `document.querySelector(${JSON.stringify(edSel)}).scrollTop`), 流top: await streamTop(cdp) };
await wheel(cdp, ep.x, ep.y, 400);
await sleep(500);
const after6 = { 编辑框top: await js(cdp, `document.querySelector(${JSON.stringify(edSel)}).scrollTop`), 流top: await streamTop(cdp) };
await js(cdp, `(() => { const el = document.querySelector(${JSON.stringify(edSel)}); el.scrollTop = el.scrollHeight; return true; })()`);
await wheel(cdp, ep.x, ep.y, -400);
await sleep(500);
const after6b = { 编辑框top: await js(cdp, `document.querySelector(${JSON.stringify(edSel)}).scrollTop`), 流top: await streamTop(cdp) };
R.C6_编辑框独立滚动 = { 编辑框: { cw: edInfo.cw, ch: edInfo.ch, sh: edInfo.sh, barW: edInfo.barW, oy: edInfo.oy }, 前: before6, 下滚400后: after6, 到底后上滚400: after6b };
// 根级滚动的可见后果(键盘误滚时整页会上移):直接设根 scrollTop 看顶栏位置
const topBarY = () => js(cdp, `Math.round(document.querySelector('header').getBoundingClientRect().y)`);
await js(cdp, `document.scrollingElement.scrollTop = 0`);
await sleep(300);
const y0 = await topBarY();
await js(cdp, `document.scrollingElement.scrollTop = 300`);
await sleep(300);
const y1 = await topBarY();
R.根滚动可见后果 = { 根top: await js(cdp, `Math.round(document.scrollingElement.scrollTop)`), 顶栏y: { 根top0: y0, 根top300: y1 }, 结论: y1 !== y0 ? '根滚动会把整页(含顶栏)上移' : '顶栏未移动' };
await js(cdp, `document.scrollingElement.scrollTop = 0`);
await clickByText(cdp, '取消');
await sleep(400);

// ---- A3 小视口下弹层的裁剪与可滚性(节模块 dev-scroll-dialogs.mjs,Emulation 页面级视口 400x300) ----
await dialogSections(R, cdp);

writeFileSync(OUT, JSON.stringify(R, null, 2));
dump('C5-C6', R);
console.log('\n写入', OUT);
close();
