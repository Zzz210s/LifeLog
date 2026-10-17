#!/usr/bin/env node
/**
 * 侧栏单击行为逐格验收:手动入口(设置页那一行)+ 两模式 × {无/Ctrl/Alt/Shift} + 容器行 + 手势 + 菜单 + 旧值回落。
 * 被测:装机版 `E:/1-LifeLog/LifeLog.exe` + CDP 9222(release origin)。真实库读写只走应用自己的
 * 写路径(`set_setting` / `save_input_note` …),夹具自建自删,收尾给库 / `filter_current` / 模式前后对照。
 * 用法:node scripts/clickmode-accept.mjs   产物:.superpowers/shots/clickmode-*.png(不入库)
 * 2026-10-16 两档化:原 `select` 档的格整段删除,改为「DOM 里取不到 select 的任何痕迹」+「旧值回落」。
 * 2026-10-17 open 档单击 = 只看这一条:卡片入口改为双击(`L.dblClickRow`),D 段与回执文案同步。
 * 2026-10-17 头部按钮已删:A 段改成「侧栏不再有模式入口 + 设置页那一行(两档/高亮/点击即生效/回执)」,
 * 切模式一律走那行(不重载,所以中途切不丢界面态);旧值 `select` 回落改成走 IPC + 重载。
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
// 与 `use-tag-click.ts` 的 MODE_ACTION 同源:open 档的单击 = 只看这一条(预览卡片退到双击)
const ACTION = { filter: '单击加入 / 移出筛选', open: '单击只看这一条、双击预览卡片' };
const R = recorder();
const rec = (item, ok, detail) => R.record(item, ok, detail);
const { cdp, close } = await ensureMain();
const { call, inventory } = bindMain(cdp);
const base0 = L.dbBase();
const inv0 = await inventory();
const baseline = { filter: await call('get_setting', { key: 'filter_current' }), mode: (await L.modeOfSetting(call)) ?? null,
  view: (await call('get_setting', { key: 'tag_view_mode' })) ?? null };
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
/** 切模式(用户路径 = 设置页 > 实体关系 > 那一行:点一下即生效,不重载,所以中途切不丢界面态)。
 *  已经是 want 就直接返回;'legacy'(IPC 不可用)原样返回。 */
const useMode = async (want) => {
  const cur = await L.clickModeOf(cdp);
  if (cur === want || cur === 'legacy') return cur;
  await L.openClickModeRow(cdp);
  const picked = await L.pickClickModeRow(cdp, want);
  await L.backToStream(cdp);
  await sleep(400);
  return picked.clicked ? await L.clickModeOf(cdp) : cur;
};
const hits = (c) => L.countHits(cdp, c);
/** 点那一行的 want 档并读四样:点没点到 / 行态 / 库 / 侧栏回执(侧栏常驻挂载,设置页里也读得到) */
const pickMode = async (want) => {
  await L.openClickModeRow(cdp);
  const picked = await L.pickClickModeRow(cdp, want);
  return { ...picked, flash: await L.flashText(cdp), stored: await L.modeOfSetting(call) };
};

// ---------- A 手动入口 = 设置页「实体关系 > 单击实体行的行为」那一行(2026-10-17 头部按钮已删) ----------
const startMode = baseline.mode === 'open' ? 'open' : 'filter';
const headerShots = [];
const a1 = await cdp.eval(`(() => ({ btn: document.querySelector('[data-testid="click-mode-button"]') !== null,
  text: (document.querySelector('aside')?.textContent ?? '').includes('点击行为') }))()`);
rec('A1 侧栏头部不再有模式入口(旧按钮消失:无 data-testid=click-mode-button、侧栏文本无「点击行为」)',
  a1.btn === false && a1.text === false, `按钮 ${a1.btn} / 侧栏文本含「点击行为」${a1.text}`);
await L.openClickModeRow(cdp);
const row0 = await L.clickModeRowState(cdp);
rec('A2 那一行 = 两档分段 + 当前档高亮(与库一致)+ 说明句写清两档的单击/双击差异',
  eq(row0?.options, ['筛选', '打开']) && eq(row0?.pressed, [startMode === 'filter', startMode === 'open'])
    && row0?.active === LABEL[startMode] && row0.rowText.includes('单击实体行的行为') && row0.rowText.includes('只看这一条'),
  `档位 ${JSON.stringify(row0?.options)} 高亮 ${JSON.stringify(row0?.pressed)} 库 ${JSON.stringify(baseline.mode)} 行文本「${row0?.rowText}」`);
const openPick = await pickMode('open');
rec('A3 点「打开」:立即落库 + 行高亮跟上 + 一句中文回执(说清下一次单击做什么)',
  openPick.clicked && openPick.mode === 'open' && openPick.stored === 'open' && openPick.row?.active === '打开'
    && openPick.flash === `已切到「打开」：${ACTION.open}（Ctrl 追加 / Alt 排除 / Shift 只看这条）`,
  `库 ${JSON.stringify(openPick.stored)} 行 ${openPick.row?.active} 回执「${openPick.flash}」`);
const filterPick = await pickMode('filter');
rec('A4 点「筛选」:立即落库 + 行高亮跟上 + 一句中文回执',
  filterPick.clicked && filterPick.mode === 'filter' && filterPick.stored === 'filter' && filterPick.row?.active === '筛选'
    && filterPick.flash === `已切到「筛选」：${ACTION.filter}（Ctrl 追加 / Alt 排除 / Shift 只看这条）`,
  `库 ${JSON.stringify(filterPick.stored)} 行 ${filterPick.row?.active} 回执「${filterPick.flash}」`);
headerShots.push(await L.shot(cdp, 'A-row-click-mode'));
await L.backToStream(cdp);
await sleep(400);

// ---------- A5 旧值回落:库里塞回两档化之前的 'select' ----------
const selStored = await L.setClickMode(cdp, 'select'); // 写旧值 + 重载(应用启动读回路径)
await L.openClickModeRow(cdp);
const fb = { mode: await L.clickModeOf(cdp), stored: await L.modeOfSetting(call), row: await L.clickModeRowState(cdp) };
rec('A5 旧值 select 回落 filter(读回即回落、库里的旧值不被改写、那一行高亮筛选)',
  selStored === 'filter' && fb.stored === 'select' && fb.mode === 'filter' && fb.row?.active === '筛选',
  `库 ${JSON.stringify(fb.stored)} -> 生效 ${fb.mode}（行高亮 ${fb.row?.active}）`);
await L.backToStream(cdp);
await sleep(300);
await L.setClickMode(cdp, baseline.mode ?? 'filter'); // 还原原始库值(收尾 R3 逐字节对账)

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
rec('R3 filter_current / sidebar_click_mode / tag_view_mode 还原为初始值(原文逐字节相同)',
  rawEnd === baseline.filter && (await L.modeOfSetting(call)) === baseline.mode && (await call('get_setting', { key: 'tag_view_mode' })) === baseline.view,
  `filter ${rawEnd} / 初始 ${baseline.filter} | mode ${await L.modeOfSetting(call)}(初始 ${baseline.mode}) | view ${await call('get_setting', { key: 'tag_view_mode' })}(初始 ${baseline.view})`);
console.log(`\n截图(${shots.length}):${shots.join(' | ')}`);
close();
R.finish();
