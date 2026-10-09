#!/usr/bin/env node
/**
 * 属性名存边上(迁移 023)的真机演示 —— 在真实库里留一条
 * `作者/丸尾常喜 --(国籍)--> 地点/日本` 的演示边,截图证明侧栏与关系图读的是**边上的属性名**。
 *
 * 与 dev-relations-demo.mjs(旧「备注 = 目标标签名字里的 md 备注」口径)的区别:
 * 本条演示边的目标标签 `地点/日本` 名字里**没有任何 md 备注**,而边上写着「国籍」——
 * 因此界面上出现的「国籍」只可能来自 `tag_links.remark`,排除了旧口径。
 *
 * 幂等:边已存在就 upsert 属性名,重复跑只重拍截图;不动别的数据(真实库除这一条演示边外只读)。
 * 前置:装机版带调试端口启动(端口用 LIFELOG_CDP_PORT 覆盖,默认 9333):
 *   `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'; E:\1-LifeLog\LifeLog.exe`
 * 用法:`node scripts/dev-relation-remark-demo.mjs`
 */
import { mkdirSync } from 'node:fs';
import { ensureMain, sleep, waitFor } from './cdp-lib.mjs';
import { bindUi } from './no-tabs-accept-lib.mjs';
import { armGraph, closeGraph } from './graph-accept-lib.mjs';
import { setSearch } from './graph-accept-g3-lib.mjs';
import {
  counts, fmt, ipc, tagIdOf, get, all, openTagMenu, pressEsc, requireApp, relationChipsOf, rowTipOf,
  deleteSetting,
} from './relations-accept-lib.mjs';
import {
  installProbe, markOf, canvasBox, shot, zoomBy, centerOnMark, rowSel, SHOTS as SHOT_DIR,
} from './relations-demo-lib.mjs';

const SOURCE = '作者/丸尾常喜';
const TARGET = '地点/日本';
const REMARK = '国籍';
const SHOTS = SHOT_DIR;
const SH = (n) => `${SHOTS}/relation-remark-${n}.png`;

requireApp();
const log = (...a) => console.log(...a);
const conn = await ensureMain();
const cdp = conn.cdp;
const ui = bindUi(cdp);
const call = (cmd, args = {}) => ipc(cdp, cmd, args);
mkdirSync(SHOTS, { recursive: true });
const waitShell = () => waitFor(() => cdp.eval(`!!document.querySelector('[data-testid="unified-input"]')`).catch(() => false), 60, 400);

const srcId = tagIdOf(SOURCE);
const tgtId = tagIdOf(TARGET);
log(`INFO 演示边 ${SOURCE}(id=${srcId}) --(${REMARK})--> ${TARGET}(id=${tgtId})`);
if (srcId === null || tgtId === null) { log(`FAIL 两端标签不存在,先在前端建好再跑`); conn.close(); process.exit(1); }

const win = await cdp.send('Browser.getWindowForTarget', { targetId: conn.target.id }).catch(() => null);
if (win?.windowId) {
  await cdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { left: 40, top: 20, width: 1480, height: 980, windowState: 'normal' } }).catch(() => null);
  await sleep(1200);
}
const notesBefore = counts().notes;
/** 源标签的全部出边(带属性名) */
const outEdges = () => all("SELECT tag_id, target_id, remark FROM tag_links WHERE tag_id=?1 AND target_type='tag' ORDER BY target_id", srcId);
const before = outEdges();
const edgeBefore = before.find((r) => r.target_id === tgtId) ?? null;
// ① 写演示边(upsert:已存在就只改属性名;这也顺带验证 set 的 upsert 语义)
await call('set_tag_relation', { fromTag: srcId, toTag: tgtId, remark: REMARK });
await sleep(800);
const rows = outEdges();
log(`INFO 库读数 源标签出边 ${before.length}->${rows.length} 本条边 ${fmt(edgeBefore)} -> ${fmt(rows.find((r) => r.target_id === tgtId))}`);

// ② 打开「标签树里显示关系」并重载,让边与开关一起上屏
await call('set_setting', { key: 'tag_tree_show_relations', value: 'true' });
await cdp.send('Page.reload');
await waitShell();
await sleep(1500);

// ③ 侧栏:展开「作者」→ 滚到源标签 → 读行内小字与悬浮卡片 → 截图
const shotFiles = [];
const srcRowReady = () => cdp.eval(`!!document.querySelector('aside ' + ${rowSel(SOURCE)})`).catch(() => false);
await waitFor(() => cdp.eval(`!!document.querySelector('aside ' + ${rowSel('作者')})`).catch(() => false), 24, 300);
if (!(await srcRowReady())) {
  const clicked = await cdp.eval(`(() => { const r = document.querySelector('aside ' + ${rowSel('作者')}); const svg = r?.querySelector('svg'); if (!svg) return false; svg.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  log(`INFO 展开作者 = ${clicked}`);
  await waitFor(srcRowReady, 20, 250);
}
const rowInfo = await waitFor(() => cdp.eval(`(() => { const r = document.querySelector('aside ' + ${rowSel(SOURCE)}); if (!r) return false; r.scrollIntoView({ block: 'center' });
  const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`), 20, 250);
await sleep(400);
const chips = await relationChipsOf(cdp, SOURCE);
const tip = await rowTipOf(cdp, SOURCE);
shotFiles.push(await shot(cdp, SH('2-sidebar-chip')));
if (rowInfo) shotFiles.push(await shot(cdp, SH('2b-sidebar-closeup'), { x: 0, y: Math.max(0, rowInfo.y - 46), width: 430, height: 230 }, 2));
log(`INFO 截图② 侧栏 chips=${fmt(chips)} 卡片各行=${fmt(String(tip).split('\n'))}`);
if (!String(chips).includes('日本') || String(chips).includes('→')) log(`FAIL 侧栏小字应只有值「日本」(无箭头、无属性名):${fmt(chips)}`);
const chipTip = await cdp.eval(`document.querySelector('aside ' + ${rowSel(SOURCE)} + ' [data-tag-relation]')?.getAttribute('data-tip') ?? null`);
if (chipTip !== REMARK) log(`FAIL 值上的悬停属性名应为「${REMARK}」:${fmt(chipTip)}`);

// ④ 关系图:搜索跳转到源标签 → 放大到备注档 → 读画布上的属性名文字 → 截图
await armGraph(ui);
await sleep(3200);
await installProbe(cdp);
await setSearch(cdp, SOURCE);
await sleep(500);
await cdp.eval(`(() => { const b = document.querySelector('[data-testid="graph-search-item"]'); if (!b) return false; b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true; })()`);
await sleep(1000);
let mark = null;
for (let t = 1; t <= 8 && mark === null; t++) {
  await zoomBy(cdp, 1);
  await sleep(350);
  mark = await markOf(cdp, REMARK);
  log(`  放大第 ${t} 档:属性名文字 ${mark ? `已画 @(${Math.round(mark.x)},${Math.round(mark.y)})` : '未画'}`);
}
const centered = mark === null ? null : await centerOnMark(cdp, REMARK, log);
if (centered) { await zoomBy(cdp, 2); await sleep(450); await centerOnMark(cdp, REMARK, log); }
await sleep(400);
const box = await canvasBox(cdp);
shotFiles.push(await shot(cdp, SH('1-graph-edge')));
const mark2 = await markOf(cdp, REMARK);
if (box && mark2) shotFiles.push(await shot(cdp, SH('1c-graph-closeup'), {
  x: box.left + Math.max(0, mark2.x - 170), y: box.top + Math.max(0, mark2.y - 75), width: 340, height: 150,
}, 2));
log(`INFO 截图① 关系图 属性名=${fmt(centered)} 复测=${fmt(mark2 && { x: Math.round(mark2.x), y: Math.round(mark2.y) })}`);
if (!mark2) log(`FAIL 画布上没画出「${REMARK}」文字`);

// ⑤ 关系面板:源标签右键「引用…」→ 读行上属性名输入框的值 → 截图
await closeGraph(ui);
await sleep(600);
await openTagMenu(cdp, SOURCE);
const paneOpen = await waitFor(() => cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('[data-tag-menu] button')).find((x) => x.textContent.trim() === '引用…'); if (!b) return false; b.click(); return true; })()`), 8, 200);
await sleep(800);
const paneRemark = await cdp.eval(`document.querySelector('[data-relation-remark="${tgtId}"]')?.value ?? null`);
const paneText = await cdp.eval(`document.querySelector('[data-tag-menu]')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 200) ?? null`);
shotFiles.push(await shot(cdp, SH('3-relation-pane')));
log(`INFO 截图③ 关系面板 open=${paneOpen} 属性名输入框=${fmt(paneRemark)} text=${fmt(paneText)}`);
await pressEsc(cdp);

// ⑥ 还原设置(演示边保留),重载回干净状态
deleteSetting('tag_tree_show_relations');
await cdp.send('Page.reload');
await waitShell();
const after = counts();
log(`\n===== 演示结果 =====`);
log(`演示边 tag_links(tag_id=${srcId}, target_type='tag', target_id=${tgtId}, remark='${rows.find((r) => r.target_id === tgtId)?.remark ?? '?'}')`);
log(`库读数 笔记 ${notesBefore}->${after.notes} 标签 ${after.tags} 源标签出边 ${rows.length}`);
log(`截图 ${shotFiles.map((f) => f.replace(/\\/g, '/')).join(' , ')}`);
conn.close();
await sleep(200);
