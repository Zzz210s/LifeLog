#!/usr/bin/env node
/**
 * 既有功能零回归(三):导出 xlsx(界面原生保存框 + 结构校验)与无限滚动(PAGE=50 翻页)。
 * 用法: node scripts/dev-cdp-accept-regress2.mjs   (先以 9222 调试端口启动 pnpm tauri dev;冷启动即可 —— 主窗由 ensureMain 前置自动打开)
 * 无限滚动的测试数据(55 条)在 finally 里删除,末尾用库存前后对照证明真实库已还原。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { ensureMain, recorder, sleep, waitFor, bindMain, conditions } from './cdp-lib.mjs';
import { bindDom } from './cdp-dom.mjs';

const { record, finish } = recorder();
const sh = (cmd, args) =>
  spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const py = (code) => sh('python', ['-c', code]).stdout.trim();
const pid = Number(sh('powershell', ['-NoProfile', '-Command', "(Get-Process | Where-Object { $_.ProcessName -match '^lifelog$' } | Select-Object -First 1).Id"]).stdout.trim());
const wins = () => JSON.parse(sh('python', ['scripts/win-probe.py', 'list', String(pid)]).stdout || '[]');
const EXPORT = `${process.cwd()}/.superpowers/tmp-arch/p5-export.xlsx`;
const SCROLL_TAG = 'P5滚动';
const SEED = 55;

const { cdp, close } = await ensureMain();
const { call, liCount, inventory } = bindMain(cdp);
const { evalIn, openTopBarMenu } = bindDom(cdp);

const inv0 = await inventory();
console.log('验收前库存:', JSON.stringify({ notes: inv0.notes, theme: inv0.theme, tagPaths: inv0.paths.length }));

// ---------- E1 界面导出:顶栏 `⋯` 菜单 -> 原生保存对话框出现并可取消 ----------
// 条件栏的「导出整库」按钮已随统一输入框 2/3 Task 2 搬走:鼠标入口在顶栏溢出菜单里
const menuPicked = await openTopBarMenu('导出整库');
// 只看目标标题的**可见**对话框:进程里可能留有其他/已完成但未关闭的 #32770 窗口
const SAVE_DLG = '另存为';
const saveDlg = () => wins().find((w) => w.cls === '#32770' && w.visible && w.title.includes(SAVE_DLG));
const dlgSeen = await waitFor(() => (saveDlg() ? true : null), 20, 300);
const dlgTitle = (saveDlg() || {}).title;
const closed = JSON.parse(sh('python', ['scripts/win-probe.py', 'close-dialog', String(pid), SAVE_DLG]).stdout || '{}');
const dlgGone = await waitFor(() => (saveDlg() ? null : true));
// 取消后状态条(「正在导出整库…」)会复位:等它消失再断言(不是回归,只是状态回写时机)
const afterCancel = await waitFor(async () => {
  const v = await evalIn(`(() => ({ busy: !!document.querySelector('[data-testid="command-status"]'), err: document.body.innerText.includes('导出失败') }))()`);
  return v.busy === false && v.err === false ? v : null;
}, 20, 300) ?? await evalIn(`(() => ({ busy: true, err: document.body.innerText.includes('导出失败') }))()`);
record(
  'E1 顶栏「导出整库」弹出原生保存框(取消后状态条复位、无错误提示)',
  menuPicked === true && dlgSeen === true && closed.closed === true && dlgGone === true && afterCancel.busy === false && afterCancel.err === false,
  `菜单点中=${menuPicked} 原生框=${JSON.stringify({ seen: dlgSeen, title: dlgTitle, closed })} 复位=${JSON.stringify(afterCancel)}`
);

// ---------- E2 导出命令 + xlsx 结构校验(openpyxl 读回) ----------
if (existsSync(EXPORT)) unlinkSync(EXPORT);
await call('export_notes', { path: EXPORT });
const size = existsSync(EXPORT) ? statSync(EXPORT).size : 0;
const dump = py(`import json, openpyxl; wb = openpyxl.load_workbook(r'${EXPORT}');
ws = wb['笔记'];
rows = [[c.value for c in r] for r in ws.iter_rows()];
print(json.dumps({'sheets': wb.sheetnames, 'header': rows[0], 'rows': rows[1:], 'count': len(rows) - 1}, ensure_ascii=False))`);
const xlsx = JSON.parse(dump);
const notesPage = await call('query_notes', { conditions: conditions({}), offset: 0 });
const heads = notesPage.slice(0, 3).map((n) => String(n.content).split('\n')[0]);
const xlsxHeads = xlsx.rows.slice(0, 3).map((r) => String(r[0]).split('\n')[0]);
record(
  'E2 导出 xlsx 结构与内容(表头两列 正文/标签,S2 起不再导出日期与最后修改 / 行数 = 笔记数 / 前三条正文一致)',
  JSON.stringify(xlsx.header) === JSON.stringify(['正文', '标签']) &&
    xlsx.count === inv0.notes &&
    JSON.stringify(xlsxHeads) === JSON.stringify(heads) &&
    xlsx.rows.some((r) => String(r[1]).includes('#')) &&
    size > 0,
  `sheet=${JSON.stringify(xlsx.sheets)} 表头=${JSON.stringify(xlsx.header)} 行数=${xlsx.count} 前三条=${JSON.stringify(xlsxHeads)} 文件=${size}B`
);

// ---------- S1 无限滚动:造 55 条(共 61 条 > PAGE=50) ----------
const seeded = [];
try {
  for (let i = 1; i <= SEED; i++) {
    const n = await call('save_input_note', { content: `${SCROLL_TAG}${String(i).padStart(2, '0')}` });
    seeded.push(n.id);
  }
  await evalIn(`location.reload()`);
  await sleep(3000);
  await waitFor(() => evalIn(`!!document.querySelector('li .md-body')`), 25, 250);
  const first = await waitFor(async () => ((await liCount()) === 50 ? true : null), 20, 300);
  // 一页 50 条、滚到底才追加下一页:反复滚到底直到不再增长(真实库上千条,不能只滚一次)
  const scrolled = await evalIn(`(() => {
    const scroller = Array.from(document.querySelectorAll('div.overflow-y-auto')).find((d) => d.querySelector('li .md-body'));
    if (!scroller) return { error: 'no-scroller' };
    scroller.scrollTop = scroller.scrollHeight;
    return { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight };
  })()`);
  let prev = -1;
  let cur = await liCount();
  let same = 0;
  for (let i = 0; i < 80 && same < 4; i++) {
    await evalIn(`(() => { const s = Array.from(document.querySelectorAll('div.overflow-y-auto')).find((d) => d.querySelector('li .md-body')); if (s) s.scrollTop = s.scrollHeight; return true; })()`);
    await sleep(700);
    cur = await liCount();
    same = cur === prev ? same + 1 : 0; // 连续 4 次不增长才判为「已到底」,单次 400ms 会把慢加载误判成结束
    prev = cur;
  }
  const loadedAll = cur === inv0.notes + SEED ? true : null;
  record(
    'S1 无限滚动:首屏 50 条 + 滚到底逐页加载到全部(验收前笔记数 + 自建 55 条)',
    first === true && loadedAll === true && !scrolled.error,
    `首屏=${first} 滚到底=${loadedAll} 滚动=${JSON.stringify(scrolled)} 实际条数=${await liCount()} 期望=${inv0.notes + SEED}`
  );
} finally {
  for (const id of seeded) await call('delete_note', { id });
  await evalIn(`location.reload()`);
  await sleep(3000);
  const inv1 = await inventory();
  const leftovers = inv1.ids.filter((x) => !inv0.ids.includes(x));
  record(
    'S2 测试数据删净 + 库存前后一致(笔记 id 清单 / 标签路径 / filter_current / theme)',
    inv1.notes === inv0.notes && inv1.filterCurrent === inv0.filterCurrent && inv1.theme === inv0.theme && JSON.stringify(inv1.paths) === JSON.stringify(inv0.paths) && leftovers.length === 0,
    `notes ${inv1.notes}/${inv0.notes} filter_current同=${inv1.filterCurrent === inv0.filterCurrent} theme ${inv1.theme}/${inv0.theme} 残留=${JSON.stringify(leftovers)} paths同=${JSON.stringify(inv1.paths) === JSON.stringify(inv0.paths)}`
  );
}

finish();
close();
