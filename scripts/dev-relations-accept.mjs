#!/usr/bin/env node
/**
 * 标签关系统一端到端读数,覆盖设计 docs/superpowers/specs/2026-10-06-tag-relation-design.md §11 的 1-8:
 *   1 迁移 022+023:user_version 23 / is_type 列消失 / 目标只有 note+tag / 24 条原边原样 / integrity ok
 *   2 关系:加/移除幂等;属性名存边上(同向重复 set 只改 remark);自指向 / 2 环 / 3 环被拒;删被指向标签后无悬空边
 *   3 筛选:关系条件命中 = 指向该标签的标签及其子树下的笔记;排除侧互补;旧字段名 types 回读
 *   4 自动合并:移动成同父同名 → 整棵并(笔记并集/子标签搬/边并集);tag_merge_log 有记录
 *   5 菜单恰五档(重命名/移动/别名/关系…/删除),不含「合并」「携带」「类型」
 *   6 侧栏行内**只显示值**(2 + `+N`)、悬停值给属性名、悬停标签名出档案卡片(标题两行 + 每条关系一行两列)
 *   7 关系图:关系边带箭头;箭头中点的属性名 = 边上的 remark;默认 k 就画(阈值 0.8),缩到聚合档(0.5)不画
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
import {
  NS, FIX, counts, fmt, ipc, sleep, waitFor, requireApp, assertDevBuild,
  noteIdOf, tagIdOf, relationRows, mergeLogRows,
  getSettingRaw, writeSetting, deleteSetting, deleteMergeLogFor,
  raiseFixtures, purgeFixtures, fixtureNoteIds, fixtureTagIds,
} from './relations-accept-lib.mjs';
import { runReadings1to4 } from './relations-accept-data.mjs';
import { runReadings5to8 } from './relations-accept-ui.mjs';

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
  record('夹具就绪(dev 构建已确认;目标标签名带 md 备注,属性名在边上)',
    dev && tA != null && tB != null && nA != null,
    `dev=${dev} 标签=${fmt({ tA, tB, tD })} 笔记=${fmt({ nA })} 属性名=${FIX.REMARK}`);

  // --- 1-4 数据层:迁移 022/023 / 关系增删与环拒绝 / 筛选 / 自动合并 ---
  const data = await runReadings1to4(call, cdp, { base, baseRelations, fixIds, nA });
  for (const x of data.records) record(x.name, x.ok, x.detail);
  structAt8 = data.structAt8;

  // --- 5-8 UI 层:菜单 / 侧栏行内与档案卡片 / 关系面板 / 关系图 / 回归 ---
  const uiReadings = await runReadings5to8(cdp, ui, { call, record, nA, structAt8, E1, E2 });
  for (const x of uiReadings.records) record(x.name, x.ok, x.detail);
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
