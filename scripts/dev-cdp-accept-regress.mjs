#!/usr/bin/env node
/**
 * 既有功能零回归(一):筛选条件(chips/添加条件/有无标签/排序)+ 设置页。
 * 用法: node scripts/dev-cdp-accept-regress.mjs   (先以 9222 调试端口启动 pnpm tauri dev;冷启动即可 —— 主窗由 ensureMain 前置自动打开)
 * 所有断言都对照真实 IPC 读数(Rust 查询)与库内既有数据,自建数据自删。
 * 注:保存视图/视图徽标随迁移 014 删除(视图体系已删),原先的 R8-R11 视图用例已作废;
 * 「日期范围」入口随日期键 D2 删除,原先的日期范围用例已作废(菜单项改为断言现有五项)。
 * 计数口径:信息流一页 50 条(与后端 PAGE 一致),故界面条数按 min(50, 笔记数) 断言。
 */
import { ensureMain, recorder, sleep, waitFor, bindMain, conditions } from './cdp-lib.mjs';
import { bindDom } from './cdp-dom.mjs';

const PAGE = 50; // 信息流一页条数(与后端一致)
const { record, finish } = recorder();
const { cdp, close } = await ensureMain();
const { call, hits, liCount, inventory } = bindMain(cdp);
const { evalIn, setBox, chips, clearChips, clickText, dlgClick, dialogLabels, menuPick, openAddCondition, reloadPage } = bindDom(cdp);

const inv0 = await inventory();
const firstPage = Math.min(PAGE, inv0.notes); // 一屏能渲染出来的条数(库有上千条时只渲染首页)
// 起点归零:整页重载,清掉上一次运行/手工调试残留的界面状态(对话框、重命名态、筛选条件)
await reloadPage();
console.log('验收前库存:', JSON.stringify({ notes: inv0.notes, theme: inv0.theme, tagPaths: inv0.paths.length, filterCurrent: inv0.filterCurrent !== null }),
  '首页条数', firstPage, '起始 chips', JSON.stringify(await chips()), '残留对话框', JSON.stringify(await dialogLabels()));

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
await openAddCondition();
await menuPick('排序');
await sleep(300);
await menuPick('最早在前');
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
  ordered !== null && sortChip.includes('最早在前'),
  `chip=${JSON.stringify(sortChip)} 前 3 条对位=${ordered !== null} 期望顺序=${JSON.stringify(wantKeys)}`
);
await clearChips();

// ---------- 3 设置页分区与返回 ----------
await evalIn(`(() => { const b = document.querySelector('button[aria-label="设置"]'); if (b) b.click(); return true; })()`);
await sleep(600);
const settingsUi = await evalIn(`(() => ({
  sections: Array.from(document.querySelectorAll('section h2')).map((h) => h.textContent.trim()),
  version: document.body.innerText.match(/\\d+\\.\\d+\\.\\d+/)?.[0] ?? null,
  dbPath: Array.from(document.querySelectorAll('p')).map((p) => p.textContent.trim()).find((t) => t.includes('lifelog.db')) ?? null,
  back: !!Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '返回信息流'),
}))()`);
record(
  'R7 设置页四个分区 + 版本号 + 数据库路径 + 返回按钮',
  ['外观', '输入栏', '启动', '通用'].every((s) => settingsUi.sections.includes(s)) &&
    settingsUi.version !== null &&
    (settingsUi.dbPath || '').includes('com.lifelog.app') &&
    settingsUi.back,
  JSON.stringify(settingsUi)
);
await clickText('返回信息流');
await sleep(600);
const backOk = await evalIn(`(() => ({
  settings: document.body.innerText.includes('应用与数据文件信息'),
  count: document.querySelectorAll('li .md-body').length,
}))()`);
record('R8 返回信息流(设置页隐藏、列表仍是首页条数)', backOk.settings === false && backOk.count === firstPage, JSON.stringify(backOk));

const inv1 = await inventory();
record(
  'R9 库存前后一致(笔记 id 清单 / 标签路径 / filter_current / theme)',
  inv1.notes === inv0.notes && JSON.stringify(inv1.ids) === JSON.stringify(inv0.ids) &&
    JSON.stringify(inv1.paths) === JSON.stringify(inv0.paths) &&
    inv1.filterCurrent === inv0.filterCurrent && inv1.theme === inv0.theme,
  `notes ${inv1.notes}/${inv0.notes} filter_current同=${inv1.filterCurrent === inv0.filterCurrent} theme ${inv1.theme}/${inv0.theme}`
);

finish();
close();
