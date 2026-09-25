#!/usr/bin/env node
/**
 * 「删标签页」批次的端到端读数(10 条;装机版 CDP,不碰物理鼠标)。
 *
 *   1 主窗信息流视图内 [role=tablist] 0 个;界面文本无「标签页」字样
 *   2 点侧栏标签 -> 条件栏出现 chip、笔记流条数与 query_notes 一致;再点一次取消
 *   3 `/` 关键词筛选 -> 提示行命中数与 query_notes 一致
 *   4 `>` 命令候选 12 条,且不含标签页命令
 *   5 重启后筛选条件保留(filter_current 有值且与界面一致)
 *   6 改标签名 -> 当前筛选里的旧路径被改写(chip 跟着变);改回原名
 *   7 侧栏两个入口是纯图标且 aria-label 可点;侧栏内无「隐藏侧栏」;顶栏那个能收/展
 *   8 统一输入框 placeholder 为空(aria-label 仍在)
 *   9 引导是 4 步(第 1 步 /1 / 4/、末步按钮「完成」),走完写标记
 *  10 数据:笔记/标签/链接数与开工前一致、integrity ok、无夹具残留
 *
 * 用法:node scripts/dev-no-tabs-accept.mjs [exe路径]
 *   exe 默认装机版 E:/1-LifeLog/LifeLog.exe;跑 dev 时传 E:/0-cargo-target/LifeLog/debug/lifelog.exe。
 *   读数 5/9 会**重启应用**(taskkill + 带调试端口拉起),故 exe 必须是当前被测构建。
 * 端口:LIFELOG_CDP_PORT(默认 9222)。夹具(笔记「UI测试无标签夹具 …」+ 标签 UI测试无标签)自建自删。
 */
import { bindMain, ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { restart } from './tutorial-accept-lib.mjs';
import {
  EMPTY_CONDITIONS, KEYWORD_FIXTURE, TAG_FIXTURE, TAG_FIXTURE_RENAMED, bindUi, chipHas, chipIs, cleanupFixtures, dbCounts,
  pickSmallTag, renameTagViaMenu, walkTutorial,
} from './no-tabs-accept-lib.mjs';

const EXE = process.argv[2] ?? 'E:/1-LifeLog/LifeLog.exe';
const EMPTY = EMPTY_CONDITIONS;
const rec = recorder();
const { record, finish } = rec;

const preDb = dbCounts();
let conn = await ensureMain();
let ui = bindUi(conn.cdp);
let bm = bindMain(conn.cdp);
const settingsBefore = {
  sidebar: await bm.call('get_setting', { key: 'sidebar_visible' }),
  tutorial: await bm.call('get_setting', { key: 'ui.tutorial_seen' }),
};

// 起点归零:整页重载(dev 下 HMR 可能滞后),之后侧栏显示出来(读数 2/6/7 都要点标签行)
await conn.cdp.send('Page.reload');
await sleep(2500);
await waitFor(() => ui.ev(`!!document.querySelector('[data-testid="unified-input"]')`), 40, 250);
if (!(await ui.sidebar())) await ui.clickByLabel('显示侧栏');
await waitFor(() => ui.sidebar(), 20, 250);
const preInv = await bm.inventory();
console.log('开工前:', JSON.stringify({ notes: preInv.notes, paths: preInv.paths.length, db: preDb, sidebarBefore: settingsBefore.sidebar }));

// ---------- 读数 1:没有标签页栏,界面也没有「标签页」字样 ----------
record('1 信息流视图内 [role=tablist] 0 个;界面文本无「标签页」',
  (await ui.tablistCount()) === 0 && (await ui.textHasTabPage()) === false,
  `tablist=${await ui.tablistCount()} 文本含「标签页」=${await ui.textHasTabPage()}`);

// ---------- 读数 7:侧栏两个入口是图标;侧栏内无收起按钮;顶栏那个能收/展 ----------
const header = await ui.tagsHeader();
const asideHide = await ui.asideHideButtons();
await ui.clickByLabel('隐藏侧栏');
const hidden = await waitFor(async () => ((await ui.sidebar()) === false ? true : null), 20, 250);
await ui.clickByLabel('显示侧栏');
const shown = await waitFor(() => ui.sidebar(), 20, 250);
record('7 侧栏两个入口为纯图标(aria-label 可点)+ 侧栏内无「隐藏侧栏」+ 顶栏可收/展',
  header.length === 2 && header.every((b) => b.text === '' && b.svg === true) && asideHide === 0 &&
    hidden === true && shown === true,
  `入口=${JSON.stringify(header)} 侧栏内收起按钮=${asideHide} 顶栏收起=${hidden} 展开=${shown}`);

// ---------- 读数 8:统一输入框没有占位文案,aria-label 仍在 ----------
const box = await ui.box();
record('8 统一输入框 placeholder 为空(aria-label 仍在)',
  box !== null && (box.placeholder === null || box.placeholder === '') && !!box.aria,
  `placeholder=${JSON.stringify(box?.placeholder)} aria-label=${JSON.stringify(box?.aria)}`);

// ---------- 读数 4:`>` 命令 12 条,不含标签页命令 ----------
await ui.setBox('>');
const cmdRows = (await waitFor(async () => {
  const rs = await ui.rows();
  return rs.length > 0 ? rs : null;
}, 12, 250)) ?? [];
await ui.setBox('');
const cmdIds = cmdRows.map((x) => x.id);
record('4 `>` 命令候选 12 条且不含标签页命令',
  cmdRows.length === 12 && !cmdIds.includes('tab.next') && !cmdIds.includes('tab.prev') &&
    !cmdRows.some((x) => (x.label ?? '').includes('标签页')),
  `候选 ${cmdRows.length} 条:${cmdIds.join(',')}`);
await sleep(300);

// ---------- 夹具:1 条笔记带 1 个标签(真实保存路径) ----------
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
await ui.focusBox();
await ui.setBox(`${KEYWORD_FIXTURE} ${stamp} #${TAG_FIXTURE}`);
await sleep(300);
await ui.ctrlEnter();
const fixtureNote = await waitFor(async () => {
  const hit = await bm.call('query_notes', { conditions: { ...EMPTY, keyword: KEYWORD_FIXTURE }, offset: 0 });
  return hit.length === 1 ? hit[0] : null;
}, 16, 250);
if (!fixtureNote) throw new Error('夹具笔记未落库,后续读数无法进行');

// ---------- 读数 3:`/` 关键词筛选的提示行命中数与后端一致 ----------
const kwBackend = (await bm.call('query_notes', { conditions: { ...EMPTY, keyword: KEYWORD_FIXTURE }, offset: 0 })).length;
await ui.setBox('/' + KEYWORD_FIXTURE);
const kwSettled = await waitFor(async () => ((await ui.streamCount()) === kwBackend ? true : null), 16, 250);
const stat = await ui.stat();
const statN = Number(/命中 (\d+) 条/.exec(stat ?? '')?.[1]);
record('3 `/` 关键词筛选:提示行命中数与 query_notes 一致',
  kwSettled === true && statN === kwBackend && kwBackend === 1, `提示行="${stat}" 后端=${kwBackend}`);
await ui.setBox('');
await ui.clearChips();
await sleep(700);

// ---------- 读数 2:点侧栏标签 -> chip + 条数与后端一致;再点取消 ----------
const picked = await pickSmallTag(bm.call, [TAG_FIXTURE]);
if (!picked) throw new Error('库里没有「含子级命中数 ≤ 20」的真实标签,读数 2 无法进行');
await ui.clickTag(picked.path);
const onChips = await chipIs(ui, picked.path);
const onStream = await waitFor(async () => {
  const n = await ui.streamCount();
  return n === picked.n ? n : null;
}, 16, 250);
record('2 点侧栏标签 -> 条件栏出现该 chip 且条数与 query_notes 一致',
  onChips !== null && onStream === picked.n,
  `标签 ${picked.path} chip=${JSON.stringify(onChips)} 界面 ${onStream}/${picked.n}`);
await ui.clickTag(picked.path);
const off = await waitFor(async () => ((await ui.chips()).length === 0 ? true : null), 16, 250);
record('2b 再点一次取消筛选(chip 清空)', off === true, `chips=${JSON.stringify(await ui.chips())}`);

// ---------- 读数 6:改标签名 -> 当前筛选里的旧路径被改写;改回原名 ----------
await ui.clickTag(TAG_FIXTURE);
const beforeChip = await chipIs(ui, TAG_FIXTURE);
await renameTagViaMenu(ui, TAG_FIXTURE, TAG_FIXTURE_RENAMED);
const renamedChip = await chipIs(ui, TAG_FIXTURE_RENAMED);
const paths1 = (JSON.parse(await bm.call('get_setting', { key: 'filter_current' }))?.tags ?? []).map((t) => t.path);
await renameTagViaMenu(ui, TAG_FIXTURE_RENAMED, TAG_FIXTURE);
const backChip = await chipIs(ui, TAG_FIXTURE);
const paths2 = (JSON.parse(await bm.call('get_setting', { key: 'filter_current' }))?.tags ?? []).map((t) => t.path);
record('6 改标签名 -> 当前筛选里的旧路径被改写(chip 文本跟着变),改回原名',
  beforeChip !== null && renamedChip !== null && paths1.includes(TAG_FIXTURE_RENAMED) &&
    !paths1.includes(TAG_FIXTURE) && backChip !== null && paths2.includes(TAG_FIXTURE) && !paths2.includes(TAG_FIXTURE_RENAMED),
  `chip ${JSON.stringify(beforeChip)} -> ${JSON.stringify(renamedChip)} -> ${JSON.stringify(backChip)};tags ${JSON.stringify(paths1)} -> ${JSON.stringify(paths2)}`);
await ui.clearChips();
await sleep(700);

// ---------- 读数 5 + 9:重启(筛选保留 / 引导 4 步) ----------
await ui.setBox('/' + KEYWORD_FIXTURE);
await waitFor(() => ui.stat(), 16, 250);
await sleep(900); // 等 300ms 防抖 + 500ms 节流写回
const filterBeforeRestart = await bm.call('get_setting', { key: 'filter_current' });
await bm.call('set_setting', { key: 'ui.tutorial_seen', value: '' });
const up = await restart(EXE);
if (!up) throw new Error(`重启后应用未在调试端口就绪(${EXE})`);
conn.close();
conn = await ensureMain();
ui = bindUi(conn.cdp);
bm = bindMain(conn.cdp);
const keptChips = await chipHas(ui, KEYWORD_FIXTURE);
const filterAfterRestart = await bm.call('get_setting', { key: 'filter_current' });
record('5 重启后筛选条件保留(filter_current 有值且与界面一致)',
  keptChips !== null && !!filterAfterRestart && filterAfterRestart === filterBeforeRestart,
  `chips=${JSON.stringify(keptChips)};filter_current ${filterBeforeRestart === filterAfterRestart ? '一致' : '不一致'}`);

const walked = await walkTutorial(ui);
record('9 引导是 4 步:第 1 步显示「1 / 4」且末步按钮是「完成」',
  walked.first !== null && (walked.first.step ?? '').includes('1 / 4') &&
    (walked.last.step ?? '').includes('4 / 4') && walked.last.next === '完成',
  `首步=${JSON.stringify(walked.first?.step)} 末步=${JSON.stringify(walked.last?.step)} 按钮=${JSON.stringify(walked.last?.next)}`);
const seen = await bm.call('get_setting', { key: 'ui.tutorial_seen' });
const closed = await ui.tutorial();
record('9 走完写标记 ui.tutorial_seen=1 且覆盖层消失',
  walked.clicked && seen === '1' && closed.open === false, `标记=${JSON.stringify(seen)} 覆盖层=${closed.open}`);

// ---------- 收尾:清夹具 + 还原设置 ----------
await ui.clearChips();
await sleep(800);
await cleanupFixtures(bm, { noteId: fixtureNote.id, settingsBefore });

// ---------- 读数 10:数据与开工前一致、integrity ok、无夹具残留 ----------
const postDb = dbCounts();
const postInv = await bm.inventory();
const leftTags = (await bm.call('list_tags')).filter((t) => t.path.startsWith('UI测试')).map((t) => t.path);
const leftNotes = postInv.ids.filter((l) => l.includes(KEYWORD_FIXTURE)).length;
record('10 数据:笔记/标签/链接数与开工前一致 + integrity ok + 无夹具残留',
  postDb.notes === preDb.notes && postDb.tags === preDb.tags && postDb.links === preDb.links &&
    postDb.integrity === 'ok' && postDb.fixtureTags === 0 && leftTags.length === 0 && leftNotes === 0 &&
    postInv.notes === preInv.notes && JSON.stringify(postInv.paths) === JSON.stringify(preInv.paths),
  `db notes ${postDb.notes}/${preDb.notes} tags ${postDb.tags}/${preDb.tags} links ${postDb.links}/${preDb.links} aliases ${postDb.aliases}/${preDb.aliases} ` +
    `integrity=${postDb.integrity} 残留标签=${JSON.stringify(leftTags)} 残留笔记=${leftNotes} 库存 ids同=${JSON.stringify(postInv.ids) === JSON.stringify(preInv.ids)}`);

finish();
conn.close();
process.exit(rec.results.some((x) => !x.ok) ? 1 : 0);
