#!/usr/bin/env node
/**
 * 标签关系统一端到端读数,覆盖设计 docs/superpowers/specs/2026-10-06-tag-relation-design.md §11 的 1-8:
 *   1 迁移 022:user_version 22 / is_type 列消失 / 目标只有 note+tag / 24 条原边原样 / integrity ok
 *   2 关系:加/移除幂等;自指向 / 2 环 / 3 环被拒(中文);删被指向标签后无悬空边
 *   3 筛选:关系条件命中 = 指向该标签的标签及其子树下的笔记;排除侧互补;旧字段名 types 回读
 *   4 自动合并:移动成同父同名 → 整棵并(笔记并集/子标签搬/边并集);tag_merge_log 有记录
 *   5 菜单恰五档(重命名/移动/别名/关系…/删除),不含「合并」「携带」「类型」
 *   6 侧栏行内 `备注 → 目标`(2 + `+N`)、开关(新键/旧键回读)、悬浮卡片列全部关系
 *   7 关系图:关系边带箭头;k ≥ 1.2 才画备注文字;信息条「关系:出 N / 入 M」
 *   8 回归:树 path/depth/sort_order、笔记 tags 列、FTS、导出不因关系而变
 * 夹具一律 `关系测试` 前缀,自建自删;结构对账排除当天时间标签 `时间/%`。
 * 用法:先起 **dev 构建**(WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333
 *   且 LIFELOG_CDP_PORT=9333),再 `node scripts/dev-relations-accept.mjs`。
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { ensureMain, recorder } from './cdp-lib.mjs';
import { bindUi } from './no-tabs-accept-lib.mjs';
import { armGraph, closeGraph } from './graph-accept-lib.mjs';
import {
  NS, FIX, counts, fmt, ipc, sleep, waitFor, requireApp, assertDevBuild,
  noteIdOf, tagIdOf, openTagMenu, pressEsc, xlsxContentDigest,
  danglingTagRows, tagStructRows, ftsTagsOf, relationRows, mergeLogRows, appNoteTags,
  getSettingRaw, writeSetting, deleteSetting, deleteMergeLogFor,
  raiseFixtures, purgeFixtures, fixtureNoteIds, fixtureTagIds,
  relationChipsOf, rowTipOf, menuItemsOf, relToggleState, clickByLabelIn, openSettings,
  pickRelationSection, backToStream, relationDegreesText, installRelationProbe, relationFrame,
  zoomBy, setSearch, pickSearchItem,
} from './relations-accept-lib.mjs';
import { runReadings1to4 } from './relations-accept-data.mjs';

await requireApp();
const dev = assertDevBuild();
const conn = await ensureMain();
const cdp = conn.cdp;
const ui = bindUi(cdp);
const call = (cmd, args = {}) => ipc(cdp, cmd, args);
const r = recorder();
const { record } = r;
const [E1, E2] = ['pre', 'post'].map((n) => join(tmpdir(), `relations-accept-${n}.xlsx`));
let failure = null;
const restore = { rel: null, old: null, filter: null };
let fixIds = [];
let nA = null;
let structAt8 = null;

await purgeFixtures(call);
await sleep(500);
const base = counts();
const baseRelations = relationRows();
const baseLogs = mergeLogRows().length;
restore.rel = getSettingRaw('tag_tree_show_relations');
restore.old = getSettingRaw('tag_tree_show_carry');
restore.filter = await call('get_setting', { key: 'filter_current' });
console.log(`INFO dev 构建=${dev} 基线=${fmt(base)}`);

try {
  // --- 夹具 ---
  await raiseFixtures(call);
  await cdp.send('Page.reload');
  await waitFor(() => cdp.eval(`!!document.querySelector('[data-testid="unified-input"]')`).catch(() => false), 60, 500);
  await sleep(1200);
  const tA = tagIdOf(FIX.A), tB = tagIdOf(FIX.B_RAW), tD = tagIdOf(FIX.D);
  nA = noteIdOf(`${NS}甲笔记`);
  fixIds = fixtureTagIds();
  record('夹具就绪(dev 构建已确认;目标标签名带 md 备注)', dev && tA != null && tB != null && nA != null,
    `dev=${dev} 标签=${fmt({ tA, tB, tD })} 笔记=${fmt({ nA })} 备注=${FIX.REMARK}`);

  // --- 1-4 数据层:迁移 022 / 关系增删与环拒绝 / 筛选 / 自动合并 ---
  const data = await runReadings1to4(call, cdp, { base, baseRelations, fixIds, nA });
  for (const x of data.records) record(x.name, x.ok, x.detail);
  structAt8 = data.structAt8;


  // --- 5 菜单五档 ---
  await openTagMenu(cdp, FIX.A);
  await sleep(300);
  const items = await menuItemsOf(cdp);
  await pressEsc(cdp);
  const want = ['重命名', '移动', '别名…', '关系…', '删除'];
  record('读数5 菜单恰五档(重命名/移动/别名/关系…/删除),不含「合并」「携带」「类型」「设为类型」',
    JSON.stringify(items) === JSON.stringify(want) && !/合并|携带|类型/.test((items ?? []).join('')),
    `items=${fmt(items)}`);

  // --- 6 侧栏行内 + 开关 + 悬浮卡片(含旧键回读) ---
  await openSettings(cdp);
  await pickRelationSection(cdp);
  const off = await waitFor(() => relToggleState(cdp), 20, 200);
  await clickByLabelIn(cdp, '标签树里显示关系');
  const on = await waitFor(() => cdp.eval(`document.querySelector('button[aria-label="标签树里显示关系"]')?.getAttribute('aria-checked') === 'true'`), 10, 200);
  await backToStream(cdp);
  await sleep(500);
  const chips = await relationChipsOf(cdp, FIX.A);
  const tip = await rowTipOf(cdp, FIX.A);
  await deleteSetting('tag_tree_show_relations');
  await writeSetting('tag_tree_show_carry', 'true'); // 旧键回读
  await cdp.send('Page.reload');
  await waitFor(() => cdp.eval(`!!document.querySelector('[data-testid="unified-input"]')`).catch(() => false), 60, 500);
  await sleep(1200);
  const chipsOld = await relationChipsOf(cdp, FIX.A);
  record('读数6 行内 2 + `+1`、悬浮卡片列全部关系、开关生效、旧键 tag_tree_show_carry 回读',
    (chips ?? []).length === 3 && chips[2] === '+1'
      && chips.some((c) => c.includes(`${FIX.REMARK} → ${NS}乙`))
      && String(tip).includes('关系：') && String(tip).includes(FIX.D) && String(tip).includes(`${FIX.REMARK} → ${NS}乙`)
      && off !== 'true' && on === true && (chipsOld ?? []).length === 3,
    `chips=${fmt(chips)} 卡片=「${String(tip).split('\n').pop()}」 开关 ${off}->${on} 旧键回读=${fmt(chipsOld)}`);

  // --- 7 关系图 ---
  await armGraph(ui);
  await sleep(2500);
  const opened = await cdp.eval(`!!document.querySelector('[data-testid="graph-view"] canvas')`);
  await installRelationProbe(cdp);
  await setSearch(cdp, FIX.A);
  await sleep(400);
  await pickSearchItem(cdp);
  await sleep(900);
  const degA = await relationDegreesText(cdp);
  const low = await relationFrame(cdp);
  await zoomBy(cdp, 12, -120);
  await sleep(700);
  const hi = await relationFrame(cdp);
  await setSearch(cdp, `${NS}乙`);
  await sleep(400);
  await pickSearchItem(cdp);
  await sleep(900);
  const degB = await relationDegreesText(cdp);
  // 箭头尖到目标圆心的距离必须 > 目标半径(挡住「画了但被后画的点盖住」):
  // 目标 = 离箭头终点最近的那个填充圆(非聚合档下就是目标节点的圆)
  const tipsClear = (frame) => {
    const dots = frame?.dots ?? [];
    const tips = frame?.arrowTips ?? [];
    if (tips.length === 0 || dots.length === 0) return false;
    return tips.every((a) => {
      const target = dots.reduce((best, d) => {
        const dist = Math.hypot(d.x - a.end[0], d.y - a.end[1]);
        return best === null || dist < best.dist ? { dist, r: d.r } : best;
      }, null);
      return Math.hypot(a.tip[0] - a.end[0], a.tip[1] - a.end[1]) > target.r;
    });
  };
  const clearHi = tipsClear(hi);
  record('读数7 关系边带箭头;k < 1.2 无备注文字、k ≥ 1.2 出备注且箭头尖不被目标圆盖住;信息条出/入度正确',
    opened && String(degA).includes('关系（含子孙）：出 3 / 入 0') && String(degB).includes('关系（含子孙）：出 0 / 入 1')
      && !(low?.texts ?? []).includes(FIX.REMARK) && (hi?.texts ?? []).includes(FIX.REMARK) && (hi?.arrowHeads ?? 0) > 0 && clearHi,
    `开图=${opened} 甲=「${degA}」 乙=「${degB}」 低缩备注=${(low?.texts ?? []).includes(FIX.REMARK)} 放大备注=${(hi?.texts ?? []).includes(FIX.REMARK)} 箭头头部=${hi?.arrowHeads ?? 0} 箭头尖无遮挡=${clearHi}`);
  await closeGraph(ui);
  await sleep(400);

  // --- 8 回归:关系写入不改结构 / 笔记 tags 列 / FTS / 导出 ---
  const tagsAt8 = await appNoteTags(cdp, `${NS}甲笔记`, nA), ftsAt8 = ftsTagsOf(nA);
  await call('export_notes', { path: E1 });
  const d1 = xlsxContentDigest(E1);
  await call('remove_tag_relation', { fromTag: tA, toTag: tB });
  await call('set_tag_relation', { fromTag: tA, toTag: tB }); // 幂等回写
  await call('export_notes', { path: E2 });
  const d2 = xlsxContentDigest(E2);
  record('读数8 树 path/depth/sort_order、笔记 tags 列、FTS、导出不因关系而变',
    JSON.stringify(tagStructRows(NS)) === structAt8 && JSON.stringify(await appNoteTags(cdp, `${NS}甲笔记`, nA)) === JSON.stringify(tagsAt8)
      && ftsAt8 != null && ftsTagsOf(nA) === ftsAt8 && d1 === d2 && danglingTagRows() === 0,
    `结构一致=${JSON.stringify(tagStructRows(NS)) === structAt8} 笔记tags=${fmt(tagsAt8)} FTS=${fmt(ftsAt8)} 导出摘要=${d1.slice(0, 16)}==${d2.slice(0, 16)}`);
} catch (e) {
  failure = e;
}

// --- 收尾:设置/筛选还原 + 夹具与合并日志删净 + 库对账 ---
try {
  if (restore.rel === null) await deleteSetting('tag_tree_show_relations');
  else await writeSetting('tag_tree_show_relations', restore.rel);
  if (restore.old === null) await deleteSetting('tag_tree_show_carry');
  else await writeSetting('tag_tree_show_carry', restore.old);
  if (restore.filter != null) await call('set_setting', { key: 'filter_current', value: restore.filter });
  await purgeFixtures(call);
  await sleep(600);
  const removedLogs = deleteMergeLogFor(fixIds);
  const after = counts();
  const diff = Object.keys(base).filter((k) => after[k] !== base[k]);
  const explainable = diff.every((k) => k === 'tags');
  record('收尾 夹具与合并日志删净 + 库对账回基线',
    fixtureNoteIds().length === 0 && fixtureTagIds().length === 0 && after.integrity === 'ok'
      && mergeLogRows().length === baseLogs && explainable && (diff.length === 0 || diff.join() === 'tags'),
    `残留=${fmt({ notes: fixtureNoteIds(), tags: fixtureTagIds() })} 日志 ${baseLogs}->${mergeLogRows().length}(删 ${removedLogs}) 不一致=${fmt(diff.map((k) => `${k} ${base[k]}->${after[k]}`))} 收尾=${fmt(after)}`);
} catch (e) {
  record('收尾 异常', false, String(e?.message ?? e));
}
for (const f of [E1, E2]) rmSync(f, { force: true });
if (failure) record('异常中断', false, String(failure?.message ?? failure));
r.finish();
conn.close();
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
