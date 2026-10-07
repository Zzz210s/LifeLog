#!/usr/bin/env node
/**
 * T6 端到端验收运行器(设计 2026-10-06 §8.5 判据 1-9 的现场复核)。
 *   LIFELOG_CDP_PORT=9333 node scripts/accept-sort-group.mjs
 * 前置:应用(装机版/开发版)已带 --remote-debugging-port 启动;主窗存在或可经托盘创建。
 * 真库只读(只写 filter_current,收尾还原);所有读数现场重算,不硬编码条数。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ensureMain, sleep, waitFor } from './cdp-lib.mjs';
import { bindMain, recorder } from './cdp-report.mjs';
import { C, allPages, axisKey, ids, isSorted, makeOrd, sameIds, tagItem, tagSort, timeSort } from './accept-sort-group-lib.mjs';
import * as UI from './accept-sort-group-ui.mjs';

const DB = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
const SHOTS = '.superpowers/shots';
const AXIS = '地点';
const OR_A = '地点/中国大陆';
const OR_B = '地点/美国';
const AND_C = '状态';
const EXPR = `(#${OR_A} OR #${OR_B}) AND #${AND_C}`;

function dbBase() {
  const db = new DatabaseSync('file:' + DB, { readOnly: true });
  const one = (q) => db.prepare(q).get();
  try {
    return {
      notes: one('SELECT COUNT(*) n FROM notes').n,
      tags: one('SELECT COUNT(*) n FROM tags').n,
      links: one('SELECT COUNT(*) n FROM tag_links').n,
      fts: one('SELECT COUNT(*) n FROM notes_fts').n,
      version: one('PRAGMA user_version').user_version,
      integrity: one('PRAGMA integrity_check').integrity_check,
    };
  } finally {
    db.close();
  }
}

const R = recorder();
const rec = (item, ok, detail) => R.record(item, ok, detail);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const nums = (xs) => [...xs].sort((a, b) => a - b);
const reload = async (cdp) => {
  await cdp.send('Page.reload', { ignoreCache: false });
  await sleep(2200);
  await UI.uiReady(cdp);
};
async function shot(cdp, name) {
  mkdirSync(SHOTS, { recursive: true });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(data, 'base64'));
  return `${SHOTS}/${name}`;
}

const base0 = dbBase();
const conn = await ensureMain();
const { cdp } = conn;
const { call } = bindMain(cdp);
const originalFilter = await call('get_setting', { key: 'filter_current' });
const tags = await call('list_tags');
const ord = makeOrd(tags);
const total = (await allPages(call, C())).length;
const paths = tags.map((t) => t.path);
rec('前置:轴与夹具标签都在真库', [AXIS, OR_A, OR_B, AND_C].every((p) => paths.includes(p)), `笔记 ${total} / 标签 ${tags.length}`);

// ---------- 排序 ----------
await UI.setFilterAndReload(cdp, call, C({ sorts: [tagSort(AXIS, 'asc', false), timeSort('desc', true)] }));
const summary1 = await UI.readSummary(cdp);
const chips1 = await UI.readChips(cdp);
await UI.openAddMenu(cdp, '排序');
const panel = await UI.readSortPanel(cdp);
const rowsOk =
  panel?.rows.length === 2 &&
  panel.rows[0].axis === AXIS && panel.rows[0].enabled === false && eq(panel.rows[0].options, ['选项顺序', '选项倒序']) &&
  panel.rows[1].axis === '时间' && panel.rows[1].enabled === true && eq(panel.rows[1].options, ['新 -> 旧', '旧 -> 新']);
rec('S1 排序面板:两条条件(第二条停用)+ 方向文案随维度变', rowsOk, JSON.stringify(panel?.rows));
rec('S2 条件栏:停用的不出 chip,摘要计启用数', summary1 === '1 条排序' && chips1.length === 1 && chips1[0].includes('新 -> 旧'), `摘要「${summary1}」 chips ${JSON.stringify(chips1)}`);
await UI.toggleSortRow(cdp, 0);
await sleep(800);
const summary2 = await UI.readSummary(cdp);
const chips2 = await UI.readChips(cdp);
const saved = JSON.parse(await call('get_setting', { key: 'filter_current' }));
rec('S3 勾选第二条 -> 2 条排序且已落库', summary2 === '2 条排序' && chips2.length === 2 && saved.sorts.length === 2 && saved.sorts[0].enabled === true, `摘要「${summary2}」 chips ${chips2.length} sorts ${JSON.stringify(saved.sorts)}`);
const shot1 = await shot(cdp, 't6-1-sort-panel.png');

const orderOf = async (dir) => {
  const notes = await allPages(call, C({ sorts: [tagSort(AXIS, dir)] }));
  const keys = notes.map((n) => axisKey(ord, n, AXIS));
  const valued = keys.filter((k) => k !== null).length;
  const fi = keys.indexOf(null);
  return {
    n: notes.length,
    valued,
    none: keys.length - valued,
    tail: keys.slice(valued).every((k) => k === null) && (fi === -1 || fi === valued),
    mono: isSorted(keys.filter((k) => k !== null), dir === 'asc' ? (a, b) => a <= b : (a, b) => a >= b),
  };
};
const asc = await orderOf('asc');
const desc = await orderOf('desc');
rec('S4 标签轴排序:有值在前、无值沉底、树序单调(asc/desc)', asc.tail && asc.mono && desc.tail && desc.mono && asc.valued === desc.valued, `asc ${JSON.stringify(asc)} / desc ${JSON.stringify(desc)}`);

await UI.pressEsc(cdp);
await UI.runCommand(cdp, '最新在前');
await sleep(1000);
const afterReset = JSON.parse(await call('get_setting', { key: 'filter_current' }));
const sumReset = await UI.readSummary(cdp);
rec('S5 一键复位回单条时间排序(空 sorts = 时间降序)', afterReset.sorts.length === 0 && !sumReset.includes('条排序'), `sorts ${JSON.stringify(afterReset.sorts)} 摘要「${sumReset}」`);
await reload(cdp);

// ---------- 条件组 ----------
const condOr = C({
  groups: [{ op: 'or', items: [tagItem(OR_A), tagItem(OR_B)] }, { op: 'and', items: [tagItem(AND_C)] }],
  groupOp: 'and',
});
await UI.setFilterAndReload(cdp, call, condOr);
const barHit = await waitFor(
  () => cdp.eval(`(() => { const el = document.querySelector('#root [data-testid="filter-group-0"]'); const m = el && el.textContent.match(/组命中 (\\d+) 条/); return m ? Number(m[1]) : null; })()`),
  30,
  300
);
const orOnly = await allPages(call, C({ groups: [{ op: 'or', items: [tagItem(OR_A), tagItem(OR_B)] }] }));
rec('C1 OR 组显示「组命中 N 条」且与后端该组单算命中一致', barHit === orOnly.length && barHit > 0, `组头「组命中 ${barHit} 条」/ 后端 ${orOnly.length}`);
const hitsGroup = nums(ids(await allPages(call, condOr)));
const hitsExpr = nums(ids(await allPages(call, C({ groups: [{ op: 'and', items: [{ kind: 'expr', value: EXPR }] }] }))));
rec('C2 条件组 (A or B) and C 命中集 = 手写表达式', sameIds(hitsGroup, hitsExpr) && hitsGroup.length > 0, `组 ${hitsGroup.length} 条 / 表达式 ${hitsExpr.length} 条`);
const inc = await allPages(call, C({ groups: [{ op: 'and', items: [tagItem(OR_A)] }] }));
const exc = await allPages(call, C({ groups: [{ op: 'and', items: [{ kind: 'excludeTag', path: OR_A, includeChildren: true }] }] }));
rec('C3 排除侧互补:命中 + 排除 = 全库(同一应用谓词)', inc.length + exc.length === total, `${inc.length} + ${exc.length} = ${inc.length + exc.length} vs 全库 ${total}`);
const shot2 = await shot(cdp, 't6-2-condition-group.png');
await reload(cdp);

// ---------- 分组 ----------
const condG = C({ groupBy: { path: AXIS, dir: 'asc' } });
await UI.setFilterAndReload(cdp, call, condG);
const sk = await call('group_skeleton', { conditions: condG });
const dom = await UI.readGroups(cdp);
const domOk =
  dom.length === sk.groups.length &&
  dom.every((g, i) => g.label === sk.groups[i].label && g.count === sk.groups[i].count && g.notes === Math.min(sk.groups[i].count, 20) && g.more === (sk.groups[i].count > 20));
rec('G1 组头/条数与 group_skeleton 逐值一致;每组首屏 20', domOk && !sk.degraded, `组数 ${dom.length} / skeleton ${sk.groups.length} degraded=${sk.degraded} slow=${sk.slow}`);
rec('G2 各组条数之和 = 全库命中数', sk.groups.reduce((a, g) => a + g.count, 0) === total, `${sk.groups.reduce((a, g) => a + g.count, 0)} vs ${total}`);
rec('G3 分组不影响命中数', (await allPages(call, condG)).length === total, `分组 ${(await allPages(call, condG)).length} vs ${total}`);

const gi = dom.findIndex((g) => g.more);
const before = (await UI.readGroups(cdp)).map((g) => g.notes);
await UI.clickGroupMore(cdp, gi);
await waitFor(async () => (await UI.readGroups(cdp))[gi]?.notes > before[gi], 30, 300);
const afterMore = await UI.readGroups(cdp);
const delta = afterMore[gi].notes - before[gi];
rec('G4 点某组「加载更多」只涨本组(组内 offset 隔离)', delta === Math.min(50, dom[gi].count - 20) && afterMore.every((g, i) => i === gi || g.notes === before[i]), `第 ${gi + 1} 组 ${before[gi]} -> ${afterMore[gi].notes} (+${delta}),别组不变`);
const ci = afterMore.findIndex((g) => g.notes > 0);
const beforeCollapse = afterMore.map((g) => g.notes);
await UI.toggleGroupHeader(cdp, ci);
await waitFor(async () => (await UI.readGroups(cdp))[ci]?.expanded === false, 20, 250);
const collapsed = await UI.readGroups(cdp);
rec('G5 折叠某组后别组卡片仍在', collapsed[ci].expanded === false && collapsed[ci].notes === 0 && collapsed.every((g, i) => i === ci || g.notes === beforeCollapse[i]), `第 ${ci + 1} 组折叠(li ${collapsed[ci].notes}),别组保持`);
const shot3 = await shot(cdp, 't6-3-group-collapsed.png');
await reload(cdp);

// ---------- 兼容:旧平铺形态 ----------
const orderNew = ids(await allPages(call, C({ groups: [{ op: 'and', items: [tagItem(AXIS)] }], sorts: [timeSort('asc')] })));
await UI.setFilterAndReload(cdp, call, { keyword: null, tags: [{ path: AXIS, includeChildren: true }], excludeTags: [], tagPresence: null, sort: 'oldest', expr: null });
const legacyChips = await UI.readChips(cdp);
const rawLegacy = JSON.parse(await call('get_setting', { key: 'filter_current' }));
const orderLegacy = ids(await allPages(call, rawLegacy));
rec('X1 旧平铺形态回读:条件不丢且与等价新形态逐值同序', legacyChips.some((c) => c.includes(AXIS)) && sameIds(orderLegacy, orderNew), `chips ${JSON.stringify(legacyChips)} / 旧 ${orderLegacy.length} 新 ${orderNew.length} 同序 ${sameIds(orderLegacy, orderNew)}`);

// ---------- 收尾对账 ----------
await call('set_setting', { key: 'filter_current', value: originalFilter });
await reload(cdp);
rec('R2 filter_current 还原为初始值', eq(JSON.parse(await call('get_setting', { key: 'filter_current' })), JSON.parse(originalFilter ?? 'null')), String(await call('get_setting', { key: 'filter_current' })));
const base1 = dbBase();
rec('R1 库基线前后一致(笔记/标签/链接/FTS/user_version/integrity)', eq(base0, base1), `前 ${JSON.stringify(base0)} / 后 ${JSON.stringify(base1)}`);
console.log(`\n截图:${shot1} | ${shot2} | ${shot3}`);
conn.close();
R.finish();
