#!/usr/bin/env node
/**
 * 既有功能零回归(一):筛选条件(chips/添加条件/有无标签/排序)+ 设置页。
 * 用法: node scripts/dev-cdp-accept-regress.mjs   (先以 9222 调试端口启动 pnpm tauri dev;冷启动即可 —— 主窗由 ensureMain 前置自动打开)
 * 所有断言都对照真实 IPC 读数(Rust 查询)与库内既有数据,自建数据自删。
 * 注:保存视图/视图徽标随迁移 014 删除(视图体系已删),原先的 R8-R11 视图用例已作废;
 * 「日期范围」入口随日期键 D2 删除,原先的日期范围用例已作废(菜单项改为断言现有五项)。
 * 计数口径:信息流一页 50 条(与后端 PAGE 一致),故界面条数按 min(50, 笔记数) 断言。
 */
import { BACK_TO_STREAM, ON_SETTINGS, ensureMain, recorder, sleep, waitFor, bindMain, conditions } from './cdp-lib.mjs';
import { bindDom } from './cdp-dom.mjs';

const PAGE = 50; // 信息流一页条数(与后端一致)
/**
 * filter_current 归一化(仅本脚本用于前后对照):null / 空串 / 空条件组都归为 'EMPTY'。
 * 为什么不能直接比原文:基线可能是「键不存在」(null),而界面清空后会写回空条件组 JSON;
 * 两者语义相同但原文不等。非空条件一律比原文(脚本会把它原样还原)。
 */
const normFilter = (raw) => {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (s === '') return 'EMPTY';
  let o;
  try { o = JSON.parse(s); } catch { return 'INVALID:' + s; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'INVALID:' + s;
  const emptyGroups = !Array.isArray(o.groups) || o.groups.length === 0;
  const emptySorts = !Array.isArray(o.sorts) || o.sorts.length === 0;
  const emptyLegacy = o.keyword == null && (!o.tags || o.tags.length === 0) &&
    (!o.excludeTags || o.excludeTags.length === 0) && o.tagPresence == null && o.expr == null &&
    (o.sort ?? 'newest') === 'newest';
  return emptyGroups && emptySorts && (o.groupBy ?? null) === null && emptyLegacy ? 'EMPTY' : s;
};
const { record, finish } = recorder();
const { cdp, close } = await ensureMain();
const { call, hits, liCount, inventory } = bindMain(cdp);
const { evalIn, setBox, chips, clearChips, clickText, dlgClick, dialogLabels, menuPick, openAddCondition, reloadPage } = bindDom(cdp);

const inv0 = await inventory();
const firstPage = Math.min(PAGE, inv0.notes); // 一屏能渲染出来的条数(库有上千条时只渲染首页)
// 起点归零:整页重载,清掉上一次运行/手工调试残留的界面状态(对话框、重命名态、筛选条件)。
// 必须显式清一次条件:R1/R5/R6 都假设「没有被残留条件收窄」,否则界面命中数与后端对不上。
await reloadPage();
console.log('验收前库存:', JSON.stringify({ notes: inv0.notes, theme: inv0.theme, tagPaths: inv0.paths.length, filterCurrent: inv0.filterCurrent !== null }),
  '首页条数', firstPage, '起始 chips', JSON.stringify(await chips()), '残留对话框', JSON.stringify(await dialogLabels()));
await clearChips();

// ---------- 1 关键词筛选与 chip(旧筛选栏关键词输入框已随统一输入框 1/3 删除:改走 `/` 模式) ----------
await setBox('/牛奶');
const kw = await waitFor(async () => {
  const c = { count: await liCount(), chips: await chips() };
  return c.count === 1 && c.chips.includes('关键词:牛奶') ? c : null;
}, 16, 250) ?? { count: await liCount(), chips: await chips() };
record('R1 关键词筛选命中 1 条并生成 chip', kw.count === 1 && kw.chips.includes('关键词:牛奶'), JSON.stringify(kw));
await setBox('');
await clearChips();
record('R2 移除 chip 后恢复首页全量', (await liCount()) === firstPage, `列表 ${await liCount()}/${firstPage}`);

// ---------- 2 添加条件菜单:标签选择器 / 有无标签 / 排序 / 表达式 ----------
// 入口已随 Task 2 搬走(旧条件栏触发按钮没了):走统一输入框的 `>添加条件` 命令
const menuOpened = await openAddCondition();
const menuItems = await evalIn(`Array.from(document.querySelectorAll('[role="menuitem"]')).map((x) => x.textContent.trim())`);
record(
  'R3 「添加条件」菜单项齐全(标签/排除标签/有无标签/排序/表达式;无日期入口)',
  menuOpened && ['标签', '排除标签', '有无标签', '排序', '表达式(高级)'].every((t) => menuItems.includes(t)) && !menuItems.some((t) => t.includes('日期')),
  JSON.stringify(menuItems)
);
await menuPick('标签');
await sleep(400);
const dlg = await waitFor(async () => (await dialogLabels())[0]);
record('R4 「标签」打开标签选择对话框', dlg === '添加标签', `dialog=${dlg}`);
await dlgClick('添加标签', '关闭');
await sleep(400);

// 有无标签 -> 无标签(所有笔记都有标签,应为 0 条 + 「没有匹配的记录」空态)
await openAddCondition();
await menuPick('有无标签');
await sleep(300);
await menuPick('无标签');
const noneState = await waitFor(async () => {
  const t = await evalIn(`document.body.innerText`);
  return t.includes('没有匹配的记录') && !t.includes('还没有记录') ? t : null;
});
const noneCount = await liCount();
const noneExpect = await hits({ tagPresence: 'none' });
record(
  'R5 「无标签」筛选:0 命中且显示无匹配空态',
  noneCount === 0 && noneExpect === 0 && noneState !== null,
  `界面 ${noneCount} 后端 ${noneExpect} 空态=${noneState !== null} chips=${JSON.stringify(await chips())}`
);
await clearChips();

// 排序:最早在前 -> 出现排序 chip,且界面首页前 3 条与后端 oldest 前 3 条逐条对位
// (行内日期已随 S2 不再显示,故改用「正文尾段对位」取证顺序)
// 排序面板 2026-10-06 改版:不再是「最新/最早」两条快捷项,而是 + 排序条件 -> 时间 -> 选方向。
await openAddCondition();
await menuPick('排序');
await sleep(300);
await evalIn(`(() => { const b = document.querySelector('[data-testid="sort-add"]'); if (b) { b.click(); return true; } return false; })()`);
await sleep(250);
await evalIn(`(() => { const b = document.querySelector('[data-testid="sort-add-time"]'); if (b) { b.click(); return true; } return false; })()`);
await sleep(300);
await evalIn(`(() => {
  const s = document.querySelector('[data-testid="sort-panel"] select');
  if (!s) return false;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, 'asc');
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
const oldestRows = await call('query_notes', { conditions: conditions({ sort: 'oldest' }), offset: 0 });
const keyOf = (s) => String(s).split('\n')[0].replace(/\s+/g, '').slice(-8);
const wantKeys = oldestRows.slice(0, 3).map((n) => keyOf(n.content));
const ordered = await waitFor(async () => {
  const texts = await evalIn(`[...document.querySelectorAll('li .md-body')].map((e) => (e.textContent || '').replace(/\\s+/g, ''))`);
  if (texts.length !== firstPage) return null;
  const idx = wantKeys.map((k) => texts.findIndex((t) => t.includes(k)));
  return idx[0] === 0 && idx[1] === 1 && idx[2] === 2 ? texts : null;
});
const sortChip = await chips();
record(
  'R6 「最早在前」排序生效(排序 chip + 界面首页前 3 条与后端 oldest 逐条对位)',
  ordered !== null && sortChip.includes('排序: 旧 -> 新'),
  `chip=${JSON.stringify(sortChip)} 前 3 条对位=${ordered !== null} 期望顺序=${JSON.stringify(wantKeys)}`
);
await clearChips();

// ---------- 3 设置页分区导航 / 关于分区读数 / 返回 ----------
await evalIn(`(() => { const b = document.querySelector('button[aria-label="设置"]'); if (b) b.click(); return true; })()`);
await sleep(600);
// 2026-10-04 设置改版:九个分区 + 左导航(一次只显示一个分区);版本号与库路径搬到「关于」
const EXPECT_SECTIONS = ['外观', '输入栏外观', '输入栏行为', '笔记', '标签关系', '快捷键', '启动', '通用', '关于'];
const navUi = await evalIn(`(() => ({
  navLabels: Array.from(document.querySelectorAll('[data-section-nav]')).map((b) => b.textContent.trim()),
  active: document.querySelector('[data-section]')?.getAttribute('data-section') ?? null,
  onSettings: ${ON_SETTINGS},
  back: !!Array.from(document.querySelectorAll('[data-testid="view-nav"] button')).find((b) => b.getAttribute('aria-label') === '信息流'),
}))()`);
await evalIn(`(() => { const b = document.querySelector('[data-section-nav="about"]'); if (b) { b.click(); return true; } return false; })()`);
await sleep(600);
const aboutUi = await evalIn(`(() => ({
  version: document.body.innerText.match(/\\d+\\.\\d+\\.\\d+/)?.[0] ?? null,
  dbPath: Array.from(document.querySelectorAll('p')).map((p) => p.textContent.trim()).find((t) => t.includes('lifelog.db')) ?? null,
}))()`);
record(
  'R7 设置页九个分区导航齐全 + 关于分区版本号与数据库路径 + 返回入口(视图导航组)',
  JSON.stringify(navUi.navLabels) === JSON.stringify(EXPECT_SECTIONS) &&
    navUi.onSettings === true &&
    navUi.back === true &&
    aboutUi.version !== null &&
    (aboutUi.dbPath || '').includes('com.lifelog.app'),
  JSON.stringify({ ...navUi, ...aboutUi })
);
await evalIn(BACK_TO_STREAM);
await sleep(600);
const backOk = await evalIn(`(() => ({
  settings: ${ON_SETTINGS},
  count: document.querySelectorAll('li .md-body').length,
}))()`);
record('R8 返回信息流(设置页隐藏、列表仍是首页条数)', backOk.settings === false && backOk.count === firstPage, JSON.stringify(backOk));

// 收尾:把 filter_current 还原为脚本启动时的原值(本脚本反复改筛选,不还原 R9 必红;
// 与 startup 验收的 cleanup 同口径:先等界面侧防抖/节流落定,写回后才是最后写者)
await sleep(1600);
await call('set_setting', { key: 'filter_current', value: inv0.filterCurrent ?? '' });
await sleep(800);
const inv1 = await inventory();
const sameFilter = normFilter(inv1.filterCurrent) === normFilter(inv0.filterCurrent);
record(
  'R9 库存前后一致(笔记 id 清单 / 标签路径 / filter_current / theme)',
  inv1.notes === inv0.notes && JSON.stringify(inv1.ids) === JSON.stringify(inv0.ids) &&
    JSON.stringify(inv1.paths) === JSON.stringify(inv0.paths) &&
    sameFilter && inv1.theme === inv0.theme,
  `notes ${inv1.notes}/${inv0.notes} filter_current同=${sameFilter} theme ${inv1.theme}/${inv0.theme}`
);

finish();
close();
