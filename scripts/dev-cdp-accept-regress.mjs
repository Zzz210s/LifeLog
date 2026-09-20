#!/usr/bin/env node
/**
 * 既有功能零回归(一):筛选条件(chips/添加条件/日期范围/无自定义标签/排序)+ 视图 CRUD 与徽标 + 设置页。
 * 用法: node scripts/dev-cdp-accept-regress.mjs   (先以 9222 调试端口启动 pnpm tauri dev;冷启动即可 —— 主窗由 ensureMain 前置自动打开)
 * 所有断言都对照真实 IPC 读数(Rust 查询/视图列表)与库内既有数据,自建数据自删。
 */
import { spawnSync } from 'node:child_process';
import { ensureMain, recorder, sleep, waitFor, bindMain } from './cdp-lib.mjs';
import { bindDom } from './cdp-dom.mjs';

const { record, finish } = recorder();
const { cdp, close } = await ensureMain();
const { call, hits, liCount, inventory } = bindMain(cdp);
const sh = (cmd, args) =>
  spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const { evalIn, setInput, dlgSetInput, chips, clearChips, clickText, dlgClick, dialogLabels, menuPick, reloadPage } = bindDom(cdp);

const inv0 = await inventory();
// 起点归零:整页重载,清掉上一次运行/手工调试残留的界面状态(对话框、重命名态、筛选条件)
await reloadPage();
console.log('验收前库存:', JSON.stringify({ notes: inv0.notes, views: inv0.views, tagPaths: inv0.paths.length }), '起始 chips', JSON.stringify(await chips()), '残留对话框', JSON.stringify(await dialogLabels()));

// ---------- 1 关键词筛选与 chip ----------
await setInput('搜索笔记与标签', '牛奶');
await sleep(800);
const kw = { count: await liCount(), chips: await chips() };
record('R1 关键词筛选命中 1 条并生成 chip', kw.count === 1 && kw.chips.includes('关键词:牛奶'), JSON.stringify(kw));
await clearChips();
record('R2 移除 chip 后恢复全量 6 条', (await liCount()) === inv0.notes, `列表 ${await liCount()}/${inv0.notes}`);

// ---------- 2 添加条件菜单:标签选择器 / 日期范围 / 有无标签 / 排序 ----------
const menuOpened = await clickText('添加条件');
await sleep(300);
const menuItems = await evalIn(`Array.from(document.querySelectorAll('[role="menuitem"]')).map((x) => x.textContent.trim())`);
record(
  'R3 「添加条件」菜单项齐全(标签/排除标签/日期范围/有无标签/排序)',
  menuOpened && ['标签', '排除标签', '日期范围', '有无标签', '排序'].every((t) => menuItems.includes(t)),
  JSON.stringify(menuItems)
);
await menuPick('标签');
await sleep(400);
const dlg = await waitFor(async () => (await dialogLabels()).find((l) => l !== '保存为视图'));
record('R4 「标签」打开标签选择对话框', dlg === '添加标签', `dialog=${dlg}`);
await dlgClick('添加标签', '关闭');
await sleep(400);

// 日期范围:2026-09-13 起(库内 09/13 两条 + 09/14 一条 + 09/13 一条 = 4 条)
await clickText('添加条件');
await sleep(300);
await menuPick('日期范围');
await sleep(400);
const dateSet = await setInput('开始日期', '2026-09-13', true);
await sleep(900);
const expectFrom = await hits({ from: '2026-09-13' });
const dateCount = await liCount();
record(
  'R5 日期范围筛选生效(界面条数 = 后端同条件命中数)',
  dateSet && dateCount === expectFrom && dateCount === 4,
  `界面 ${dateCount} 后端 ${expectFrom} chips=${JSON.stringify(await chips())}`
);
await evalIn(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '完成'); if (b) b.click(); return true; })()`);
await clearChips();

// 有无标签 -> 无自定义标签(库内 6 条都有标签,应为 0 条 + 「没有匹配的记录」空态)
await clickText('添加条件');
await sleep(300);
await menuPick('有无标签');
await sleep(300);
await menuPick('无自定义标签');
const noneState = await waitFor(async () => {
  const t = await evalIn(`document.body.innerText`);
  return t.includes('没有匹配的记录') && !t.includes('还没有记录') ? t : null;
});
const noneCount = await liCount();
const noneExpect = await hits({ tagPresence: 'none' });
record(
  'R6 「无自定义标签」筛选:0 命中且显示无匹配空态',
  noneCount === 0 && noneExpect === 0 && noneState !== null,
  `界面 ${noneCount} 后端 ${noneExpect} 空态=${noneState !== null} chips=${JSON.stringify(await chips())}`
);
await clearChips();

// 排序:最早在前 -> 顺序反转
await clickText('添加条件');
await sleep(300);
await menuPick('排序');
await sleep(300);
await menuPick('最早在前');
const ordered = await waitFor(async () => {
  const d = await evalIn(`Array.from(document.querySelectorAll('button[aria-label="修改日期"]')).map((b) => b.textContent.trim())`);
  return d.length === inv0.notes && d[0] === '2026-09-11' ? d : null;
});
record(
  'R7 「最早在前」排序生效(首条为最早日期)',
  Array.isArray(ordered) && ordered[ordered.length - 1] === '2026-09-14',
  JSON.stringify(ordered)
);
await clearChips();

// ---------- 3 视图 CRUD 与徽标(走真实界面) ----------
const badgeOf = (id) => evalIn(`(() => { const r = document.querySelector('[data-view-id="' + ${JSON.stringify(String(id))} + '"]'); const b = r ? r.querySelector('span.ml-auto > span') : null; return b ? b.textContent.trim() : null; })()`);
const builtin = await evalIn(`(() => Array.from(document.querySelectorAll('[data-view-key]')).map((r) => r.getAttribute('data-view-key') + '=' + r.textContent.trim()))()`);
const hitMap0 = Object.fromEntries(await call('count_view_hits'));
const badgeOfKey = (k) => hitMap0[k] ?? hitMap0['view:' + k];
const builtinOk =
  ['all', 'todo', 'untagged'].every((k) => builtin.some((r) => r.startsWith(k + '=') && r.endsWith(String(badgeOfKey(k))))) &&
  builtin.some((r) => r.startsWith('all=全部'));
record('R8 内置视图三项与徽标读数(全部/待办/无自定义标签)', builtinOk, `行=${JSON.stringify(builtin)} 后端徽标=${JSON.stringify(hitMap0)}`);

await evalIn(`(() => { const b = document.querySelector('[aria-label="新建视图"]'); if (b) b.click(); return true; })()`);
const dlgOpen = await waitFor(() => evalIn(`!!document.querySelector('[role="dialog"]')`));
const titleTyped = await dlgSetInput('保存为视图', '视图标题', 'P5回归视图');
await sleep(200);
const saveClicked = await dlgClick('保存为视图', '保存');
const created = await waitFor(async () => (await call('list_views')).find((v) => v.title === 'P5回归视图'));
const dlgText = await evalIn(`(() => { const d = Array.from(document.querySelectorAll('[role="dialog"]')).find((x) => x.getAttribute('aria-label') === '保存为视图'); return d ? d.textContent.trim().slice(0, 80) : null; })()`);
const hitMap = Object.fromEntries(await call('count_view_hits'));
const newBadge = created ? await waitFor(() => badgeOf(created.id)) : null;
record(
  'R9 新建视图对话框保存成功且徽标 = 后端命中数',
  dlgOpen === true && titleTyped === true && saveClicked === true && !!created && newBadge === String(hitMap['view:' + created.id]),
  `对话框=${dlgOpen} 标题输入=${titleTyped} 保存=${saveClicked} id=${created ? created.id : null} 徽标=${newBadge} 后端=${hitMap['view:' + (created ? created.id : 0)]} 对话框文本=${dlgText}`
);
if (!created) {
  finish();
  close();
  process.exit(1);
}
await evalIn(`(() => { const b = document.querySelector('[aria-label="重命名视图 P5回归视图"]'); if (b) b.click(); return true; })()`);
await sleep(400);
const renameTyped = await evalIn(`(() => {
  const input = Array.from(document.querySelectorAll('input[aria-label="视图标题"]')).find((i) => !i.closest('[role="dialog"]'));
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'P5回归视图改');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return true;
})()`);
const renamed = await waitFor(async () => (await call('list_views')).find((v) => v.id === created.id && v.title === 'P5回归视图改'));
record('R10 视图行内重命名生效(界面 + 库)', renameTyped === true && !!renamed, `输入框定位=${renameTyped} 库内=${renamed && renamed.title}`);

await evalIn(`(() => { const b = document.querySelector('[aria-label="删除视图 P5回归视图改"]'); if (b) b.click(); return true; })()`);
await sleep(1200);
const pid = Number(sh('powershell', ['-NoProfile', '-Command', "(Get-Process | Where-Object { $_.ProcessName -match '^lifelog$' } | Select-Object -First 1).Id"]).stdout.trim());
const winList = () => {
  const r = sh('python', ['scripts/win-probe.py', 'list', String(pid)]);
  return r.stdout ? JSON.parse(r.stdout) : [];
};
const delClicked = await evalIn(`(() => { const b = document.querySelector('[aria-label="删除视图 P5回归视图改"]'); if (b) { b.click(); return true; } return false; })()`);
const dlgSeen = await waitFor(() => winList().some((w) => w.cls === '#32770') && true, 20, 300);
const dlgResult = JSON.parse(sh('python', ['scripts/win-probe.py', 'click-ok', String(pid)]).stdout || '{}');
const deleted = await waitFor(async () => (await call('list_views')).every((v) => v.id !== created.id));
const badgeGone = await waitFor(async () => ((await badgeOf(created.id)) === null ? true : null));
record(
  'R11 删除视图(原生确认框点「确定」)-> 行消失、库内删除',
  delClicked === true && dlgSeen === true && dlgResult.clicked === true && deleted === true && badgeGone === true,
  `pid=${pid} 删除按钮=${delClicked} 原生框=${JSON.stringify(dlgResult)} 库内已删=${deleted} 行已消失=${badgeGone}`
);

// ---------- 4 设置页分区与返回 ----------
await evalIn(`(() => { const b = document.querySelector('button[aria-label="设置"]'); if (b) b.click(); return true; })()`);
await sleep(600);
const settingsUi = await evalIn(`(() => ({
  sections: Array.from(document.querySelectorAll('section h2')).map((h) => h.textContent.trim()),
  version: document.body.innerText.match(/\\d+\\.\\d+\\.\\d+/)?.[0] ?? null,
  dbPath: Array.from(document.querySelectorAll('p')).map((p) => p.textContent.trim()).find((t) => t.includes('lifelog.db')) ?? null,
  back: !!Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '返回信息流'),
}))()`);
record(
  'R12 设置页四个分区 + 版本号 + 数据库路径 + 返回按钮',
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
record('R13 返回信息流(设置页隐藏、列表仍是 6 条)', backOk.settings === false && backOk.count === inv0.notes, JSON.stringify(backOk));

// 清理兜底:界面删除链路失败时不留残留视图(不计入断言,只保证库存干净)
const leftover = (await call('list_views')).filter((v) => v.title.startsWith('P5回归'));
for (const v of leftover) await call('delete_view', { id: v.id });
if (leftover.length) console.log('清理兜底:删除残留视图', JSON.stringify(leftover.map((v) => v.title)));
const inv1 = await inventory();
record(
  'R14 库存前后一致(笔记 id 清单 / 标签路径 / 视图数)',
  inv1.notes === inv0.notes && inv1.views === inv0.views && JSON.stringify(inv1.paths) === JSON.stringify(inv0.paths),
  `notes ${inv1.notes}/${inv0.notes} views ${inv1.views}/${inv0.views}`
);

finish();
close();
