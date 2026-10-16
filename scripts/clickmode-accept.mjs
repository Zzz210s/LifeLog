#!/usr/bin/env node
/**
 * 侧栏单击行为逐格验收:头部两档 + 两模式 × {无/Ctrl/Alt/Shift} + 容器行 + 手势 + 菜单 + 旧值回落。
 * 被测:装机版 `E:/1-LifeLog/LifeLog.exe` + CDP 9222(release origin)。真实库读写只走应用自己的
 * 写路径(`set_setting` / `save_input_note` …),夹具自建自删,收尾给库 / `filter_current` / 模式前后对照。
 * 用法:node scripts/clickmode-accept.mjs   产物:.superpowers/shots/clickmode-*.png(不入库)
 * 2026-10-16 两档化:原 `select` 档的格整段删除,改为「DOM 里取不到 select 的任何痕迹」+「旧值回落」。
 */
import { ensureMain, sleep, waitFor, recorder, bindMain } from './cdp-lib.mjs';
import * as L from './clickmode-accept-lib.mjs';
import { runRowCells } from './clickmode-accept-row.mjs';
import { runGestureCells } from './clickmode-accept-gesture.mjs';

const EMPTY = { keyword: null, tags: [], excludeTags: [], relations: [], excludeRelations: [], tagPresence: null,
  sort: 'newest', sorts: [], groupBy: null, expr: null, groupOp: 'and', groups: [] };
const F = (over = {}) => ({ ...EMPTY, ...over });
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const LABEL = { filter: '筛选', open: '打开' };
const ACTION = { filter: '单击加入 / 移出筛选', open: '单击打开实体' };
const R = recorder();
const rec = (item, ok, detail) => R.record(item, ok, detail);
const { cdp, close } = await ensureMain();
const { call, inventory } = bindMain(cdp);
const base0 = L.dbBase();
const inv0 = await inventory();
const baseline = { filter: await call('get_setting', { key: 'filter_current' }), mode: (await L.modeOfSetting(call)) ?? null };
const readFilter = async () => JSON.parse((await call('get_setting', { key: 'filter_current' })) ?? 'null');
/** 写条件 -> 重载 -> 等界面挂载(走应用真实的 parseFilterState 回读路径)。
 *  先静置 600ms(`use-filter-state` 的写回节流是 500ms):让挂起的写回先落地,
 *  免得重载时「卸载补写」把我刚写的值盖回页面自己的旧状态。 */
const setFilter = async (c) => {
  await sleep(600);
  await call('set_setting', { key: 'filter_current', value: JSON.stringify(c) });
  await cdp.send('Page.reload', { ignoreCache: false });
  await waitFor(() => cdp.eval(`!!document.querySelector('#root [data-testid="unified-input"]')`), 40, 250);
  await sleep(500);
};
/** 切模式:按钮点一次只轮转一档,且 `data-click-mode` 是 React 渲染后才更新的,
 *  所以必须「先读后点」(点完立刻读会读到点击前的值)。两档 -> 最多点一次。 */
const useMode = async (want) => {
  for (let i = 0; i < 2 && (await L.modeState(cdp)).mode !== want; i++) {
    await L.clickModeButton(cdp);
    await sleep(450);
  }
  return (await L.modeState(cdp)).mode;
};
const hits = (c) => L.countHits(cdp, c);

// ---------- A 头部按钮两档 ----------
const startMode = baseline.mode ?? 'filter';
const st0 = await L.modeState(cdp);
rec('A1 模式按钮四件套:data-click-mode / aria-label「点击行为：X」/ title 含下一档 / 无 aria-pressed',
  st0.mode === startMode && st0.label === `点击行为：${LABEL[startMode]}` && /点一下切到/.test(st0.title) && st0.pressed === null,
  `mode=${st0.mode} label=${st0.label} title=${st0.title} pressed=${st0.pressed} 库=${baseline.mode}`);
const seq = [];
const headerShots = [];
for (let i = 0; i < 2; i++) {
  const from = await L.modeState(cdp);
  await L.clickModeButton(cdp);
  await sleep(450);
  const after = await L.modeState(cdp);
  headerShots.push(await L.shot(cdp, `A-header-${after.mode}`));
  seq.push({ from: from.mode, to: after.mode, icon: after.icon, flash: await L.flashText(cdp), db: await L.modeOfSetting(call) });
}
const rotFrom = seq.map((x) => x.from);
const rotTo = seq.map((x) => x.to);
rec('A2 轮转只两档:点一下换一档、再点一下回到原档(两次点击的 DOM 序列)',
  rotTo[0] === (rotFrom[0] === 'filter' ? 'open' : 'filter') && rotTo[1] === rotFrom[0],
  seq.map((x) => `${x.from}->${x.to}`).join(' , '));
rec('A3 两档图标 path 互不相同', new Set(seq.map((x) => x.icon)).size === 2, seq.map((x) => String(x.icon).slice(0, 24)).join(' | '));
rec('A4 每次切换一句话中文回执(说清下一次单击做什么 + 三个修饰键)',
  seq.every((x) => x.flash === `已切到「${LABEL[x.to]}」：${ACTION[x.to]}（Ctrl 追加 / Alt 排除 / Shift 只看这条）`),
  seq.map((x) => x.flash).join(' || '));
rec('A5 每次切换立即落库(sidebar_click_mode 与 DOM 同步)', seq.every((x) => x.db === x.to), seq.map((x) => `DOM ${x.to} / 库 ${x.db}`).join(' , '));

// ---------- A6 旧值回落:库里塞回两档化之前的 'select' ----------
await sleep(600);
await call('set_setting', { key: 'sidebar_click_mode', value: 'select' });
await cdp.send('Page.reload', { ignoreCache: false });
await waitFor(() => cdp.eval(`!!document.querySelector('#root [data-testid="unified-input"]')`), 40, 250);
await sleep(600);
const fb = { mode: (await L.modeState(cdp))?.mode ?? null, stored: await L.modeOfSetting(call), label: (await L.modeState(cdp))?.label ?? null };
rec('A6 旧值 select 回落 filter(读回即回落,库里旧值不被改写)',
  fb.stored === 'select' && fb.mode === 'filter' && fb.label === '点击行为：筛选',
  `库 ${JSON.stringify(fb.stored)} -> DOM ${fb.mode}（${fb.label}）`);
await sleep(600);
await call('set_setting', { key: 'sidebar_click_mode', value: baseline.mode ?? 'filter' });
await cdp.send('Page.reload', { ignoreCache: false });
await sleep(1500);

// ---------- B/D 行内格 + C「select 无痕」格 ----------
const row = await runRowCells({ cdp, call, rec, eq, useMode, setFilter, readFilter, hits, L, F });
const built = await runGestureCells({ cdp, call, rec, useMode, setFilter, readFilter, hits, L, F, A: row.A });
const shots = [...headerShots, ...row.shots, ...built.shots];

// ---------- 收尾:设置还原 + 库对账 ----------
await sleep(700); // 让页面挂起的写回先落地(否则重载的「卸载补写」会盖回旧状态)
await call('set_setting', { key: 'filter_current', value: baseline.filter ?? 'null' });
await useMode(baseline.mode ?? 'filter');
await cdp.send('Page.reload', { ignoreCache: false });
await sleep(2500);
const rawEnd = await call('get_setting', { key: 'filter_current' });
const left = (await call('list_tags')).filter((t) => t.path.startsWith('单击验收')).map((t) => t.path);
const base1 = L.dbBase();
const inv1 = await inventory();
rec('R1 库基线前后一致(points/lines/user_version/integrity + 夹具点数为 0)', eq(base0, base1) && base1.fixturePoints === 0,
  `前 ${JSON.stringify(base0)} / 后 ${JSON.stringify(base1)} 残留标签 ${JSON.stringify(left)}`);
rec('R2 应用读数基线一致(实体数 / 标签路径集合)', eq(inv0, inv1), `实体 ${inv1.notes}/${inv0.notes} 标签 ${inv1.paths.length}/${inv0.paths.length}`);
rec('R3 filter_current / sidebar_click_mode 还原为初始值(原文逐字节相同)',
  rawEnd === baseline.filter && (await L.modeOfSetting(call)) === baseline.mode,
  `filter ${rawEnd} / 初始 ${baseline.filter} | mode ${await L.modeOfSetting(call)}(初始 ${baseline.mode})`);
console.log(`\n截图(${shots.length}):${shots.join(' | ')}`);
close();
R.finish();
