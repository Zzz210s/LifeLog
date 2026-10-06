#!/usr/bin/env node
/**
 * 关系备注(A 方案:底衬胶囊)真机演示 —— 用装机版把一条「带备注的关系边」留在真实库里给用户看。
 *
 * 与 dev-relations-accept.mjs 的区别:**不清理夹具**(用户要自己看),只还原设置;夹具前缀 `关系演示`。
 * 幂等:夹具/改名/关系已存在就跳过,重复跑只重拍截图。探针与截图件在 relations-demo-lib.mjs。
 * 前置:装机版带调试端口启动
 *   `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'; E:\1-LifeLog\LifeLog.exe`
 * 用法:`node scripts/dev-relations-demo.mjs`(端口用 LIFELOG_CDP_PORT 覆盖)。
 */
import { mkdirSync } from 'node:fs';
import { ensureMain, sleep, waitFor } from './cdp-lib.mjs';
import { bindUi } from './no-tabs-accept-lib.mjs';
import { armGraph, closeGraph } from './graph-accept-lib.mjs';
import { setSearch } from './graph-accept-g3-lib.mjs';
import {
  counts, fmt, get, ipc, tagIdOf, noteIdOf, openTagMenu, pressEsc, requireApp, deleteSetting,
  relationRows, relationChipsOf, rowTipOf, relationDegreesText,
} from './relations-accept-lib.mjs';
import {
  ROOT, CHILD_PLAIN, CHILD_MD, REMARK, SOURCE, NOTE, SHOTS, SH,
  installProbe, probe, markOf, canvasBox, rowSel, centerOnMark, shot, zoomBy,
} from './relations-demo-lib.mjs';

requireApp();
const log = (...a) => console.log(...a);
const conn = await ensureMain();
const cdp = conn.cdp;
const ui = bindUi(cdp);
const call = (cmd, args = {}) => ipc(cdp, cmd, args);
mkdirSync(SHOTS, { recursive: true });
const waitShell = () => waitFor(() => cdp.eval(`!!document.querySelector('[data-testid="unified-input"]')`).catch(() => false), 60, 400);

const win = await cdp.send('Browser.getWindowForTarget', { targetId: conn.target.id }).catch(() => null);
if (win?.windowId) {
  await cdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { left: 40, top: 20, width: 1480, height: 980, windowState: 'normal' } }).catch(() => null);
  await sleep(1200);
}
const before = counts();
const relBefore = relationRows();
log(`INFO 基线 笔记${before.notes} 标签${before.tags} 关系边${relBefore.length}`);

// 1 夹具(幂等):锚笔记带出两个标签 → 界面「重命名」把子标签改成带备注的 md 名 → 建关系
if (noteIdOf(NOTE) === null) { await call('save_input_note', { content: `${NOTE}\n#${CHILD_PLAIN}` }); await sleep(900); }
const rootId = tagIdOf(ROOT);
let childRow = rootId == null ? null : get('SELECT id, path FROM tags WHERE parent_id = ?1', rootId);
log(`INFO 夹具 root=${rootId} child=${fmt(childRow)}`);
const srcId = tagIdOf(SOURCE);

const ensured = await waitFor(() => cdp.eval(`!!document.querySelector('aside ' + ${rowSel(ROOT)})`).catch(() => false), 24, 300);
if (childRow && childRow.path === CHILD_PLAIN && ensured) {
  const opened = await openTagMenu(cdp, CHILD_PLAIN);
  await waitFor(() => cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('[data-tag-menu] button')).find((x) => x.textContent.trim() === '重命名'); if (!b) return false; b.click(); return true; })()`), 8, 200);
  await waitFor(() => cdp.eval(`(() => { const i = document.querySelector('input[aria-label="新标签名"]'); if (!i) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(CHILD_MD)});
    i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`), 8, 200);
  await waitFor(() => cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('[data-tag-menu] button')).find((x) => x.textContent.trim() === '确定'); if (!b) return false; b.click(); return true; })()`), 8, 200);
  await sleep(1000);
  await pressEsc(cdp);
  childRow = get('SELECT id, path FROM tags WHERE parent_id = ?1', rootId);
  log(`INFO 界面重命名 右键=${opened} 新路径=${childRow?.path}`);
} else log(`INFO 重命名跳过(已是 md 名或标签未就绪)`);
const childId = childRow?.id ?? null;
const hadRel = relBefore.some((r) => r.tag_id === srcId && r.target_id === childId);
if (!hadRel) { await call('set_tag_relation', { fromTag: srcId, toTag: childId }); await sleep(800); }
log(`INFO 关系 ${SOURCE}(${srcId}) -> ${childId} 已有=${hadRel}`);

// 2 打开「标签树里显示关系」并重载,让改名与开关一起上屏
await call('set_setting', { key: 'tag_tree_show_relations', value: 'true' });
await cdp.send('Page.reload');
await waitShell();
await sleep(1500);

// 侧栏:按需展开作者(已在展开态时再点会把它收起)→ 滚到源标签 → 截图 ②(行内小字)
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
// 悬浮卡片:行上 data-tip 由 document 上的 mouseover 委托接管,合成事件即可弹出完整关系文案
await cdp.eval(`(() => { const r = document.querySelector('aside ' + ${rowSel(SOURCE)}); if (!r) return false; r.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return true; })()`);
await sleep(400);
if (rowInfo) shotFiles.push(await shot(cdp, SH('2b-sidebar-closeup'), { x: 0, y: Math.max(0, rowInfo.y - 46), width: 430, height: 230 }, 2));
log(`INFO 截图② 侧栏 chips=${fmt(chips)} 卡片各行=${fmt(String(tip).split('\n'))}`);

// 3 关系图:默认档 k=0.8 以上就画备注(旧脚本流程:搜索跳转把相机摆到源标签,再对准那条边)
await armGraph(ui);
await sleep(3200);
await installProbe(cdp);
await setSearch(cdp, SOURCE);
await sleep(500);
await cdp.eval(`(() => { const b = document.querySelector('[data-testid="graph-search-item"]'); if (!b) return false; b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true; })()`);
await sleep(1000);
log(`INFO 信息条 ${fmt(await relationDegreesText(cdp))}`);
let mark = null;
for (let t = 1; t <= 8 && mark === null; t++) {
  await zoomBy(cdp, 1);
  await sleep(350);
  mark = await markOf(cdp, REMARK);
  log(`  放大第 ${t} 档:备注文字 ${mark ? `已画 @(${Math.round(mark.x)},${Math.round(mark.y)})` : '未画'}`);
}
const centered = mark === null ? null : await centerOnMark(cdp, REMARK, log);
// 备注已在画布中心,再放大两档把那圈标签撑开(文字恒 12px,间距随 k 拉开 → 胶囊更容易分离)
if (centered) {
  await zoomBy(cdp, 2);
  await sleep(450);
  await centerOnMark(cdp, REMARK, log);
}
await sleep(400);
const frame = await probe(cdp);
shotFiles.push(await shot(cdp, SH('1-graph-edge')));
const box = await canvasBox(cdp);
const mark2 = await markOf(cdp, REMARK);
if (box) shotFiles.push(await shot(cdp, SH('1b-graph-canvas'), { x: box.left, y: box.top, width: box.w, height: box.h }));
if (box && mark2) shotFiles.push(await shot(cdp, SH('1c-graph-closeup'), {
  x: box.left + Math.max(0, mark2.x - 170), y: box.top + Math.max(0, mark2.y - 75), width: 340, height: 150,
}, 2));
if (box && mark2) shotFiles.push(await shot(cdp, SH('1d-capsule'), {
  x: box.left + Math.max(0, mark2.x - 100), y: box.top + Math.max(0, mark2.y - 45), width: 200, height: 92,
}, 3));
log(`INFO 截图① 关系图 备注=${fmt(centered)} 复测=${fmt(mark2 && { x: Math.round(mark2.x), y: Math.round(mark2.y) })} 圆数=${(frame?.dots ?? []).length} 文字数=${(frame?.texts ?? []).length}`);

// 4 关系面板:源标签右键「关系…」,看这条当前关系
await closeGraph(ui);
await sleep(600);
await openTagMenu(cdp, SOURCE);
const paneOpen = await waitFor(() => cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('[data-tag-menu] button')).find((x) => x.textContent.trim() === '关系…'); if (!b) return false; b.click(); return true; })()`), 8, 200);
await sleep(800);
shotFiles.push(await shot(cdp, SH('3-relation-pane')));
const paneText = await cdp.eval(`document.querySelector('[data-tag-menu]')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 300) ?? null`);
log(`INFO 截图③ 关系面板 open=${paneOpen} text=${fmt(paneText)}`);
await pressEsc(cdp);

// 5 还原设置(夹具保留),再重载一次让运行中的应用回到干净状态
deleteSetting('tag_tree_show_relations');
await cdp.send('Page.reload');
await waitShell();
const relAfter = relationRows();
const after = counts();
log(`\n===== 演示结果 =====`);
log(`夹具 根标签 ${ROOT}(id=${rootId}) · 目标标签 ${childRow?.path}(id=${childId},备注「${REMARK}」) · 关系 ${SOURCE}(id=${srcId})->${childId} · 锚笔记「${NOTE}」`);
log(`库读数 笔记 ${before.notes}->${after.notes} 标签 ${before.tags}->${after.tags} 关系边 ${relBefore.length}->${relAfter.length}`);
log(`截图 ${shotFiles.map((f) => f.replace(/\\/g, '/')).join(' , ')}`);
conn.close();
await sleep(200);
