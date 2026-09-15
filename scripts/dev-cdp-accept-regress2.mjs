#!/usr/bin/env node
/**
 * 既有功能零回归(三):导出 xlsx(界面原生保存框 + 结构校验)与无限滚动(PAGE=50 翻页)。
 * 用法: node scripts/dev-cdp-accept-regress2.mjs   (先以 9222 调试端口启动 pnpm tauri dev)
 * 无限滚动的测试数据(55 条)在 finally 里删除,末尾用库存前后对照证明真实库已还原。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { open, recorder, sleep, waitFor, bindMain } from './cdp-lib.mjs';
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

const { cdp, close } = await open('main');
const { call, liCount, inventory } = bindMain(cdp);
const { evalIn, clickText } = bindDom(cdp);

const inv0 = await inventory();
console.log('验收前库存:', JSON.stringify({ notes: inv0.notes, views: inv0.views, tagPaths: inv0.paths.length }));

// ---------- E1 界面导出:原生保存对话框出现并可取消 ----------
await clickText('导出全部');
// 只看目标标题的**可见**对话框:进程里可能留有其他/已完成但未关闭的 #32770 窗口
const SAVE_DLG = '另存为';
const saveDlg = () => wins().find((w) => w.cls === '#32770' && w.visible && w.title.includes(SAVE_DLG));
const dlgSeen = await waitFor(() => (saveDlg() ? true : null), 20, 300);
const dlgTitle = (saveDlg() || {}).title;
const closed = JSON.parse(sh('python', ['scripts/win-probe.py', 'close-dialog', String(pid), SAVE_DLG]).stdout || '{}');
const dlgGone = await waitFor(() => (saveDlg() ? null : true));
const afterCancel = await evalIn(`(() => ({ btn: !!Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '导出全部'), err: document.body.innerText.includes('导出失败') }))()`);
record(
  'E1 点「导出全部」弹出原生保存框(取消后按钮复位、无错误提示)',
  dlgSeen === true && closed.closed === true && dlgGone === true && afterCancel.btn === true && afterCancel.err === false,
  `原生框=${JSON.stringify({ seen: dlgSeen, title: dlgTitle, closed })} 复位=${JSON.stringify(afterCancel)}`
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
const noteDates = (await call('query_notes', { conditions: { keyword: null, tags: [], excludeTags: [], from: null, to: null, tagPresence: null, sort: 'newest' }, offset: 0 })).map((n) => n.date).sort();
const dates = xlsx.rows.map((r) => r[0]).sort();
record(
  'E2 导出 xlsx 结构与内容(表头四列 / 行数 = 笔记数 / 日期列 = 笔记日期)',
  JSON.stringify(xlsx.header) === JSON.stringify(['日期', '正文', '标签', '最后修改']) &&
    xlsx.count === inv0.notes &&
    JSON.stringify(dates) === JSON.stringify(noteDates) &&
    xlsx.rows.some((r) => String(r[2]).includes('#todo')) &&
    size > 0,
  `sheet=${JSON.stringify(xlsx.sheets)} 表头=${JSON.stringify(xlsx.header)} 行数=${xlsx.count} 日期列=${JSON.stringify(dates)} 文件=${size}B`
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
  await waitFor(() => evalIn(`!!document.querySelector('[data-testid="time-list"]')`));
  const first = await waitFor(async () => (await liCount()) === 50 && true, 20, 300);
  const scrolled = await evalIn(`(() => {
    const scroller = Array.from(document.querySelectorAll('div.overflow-y-auto')).find((d) => d.querySelector('li .md-body'));
    if (!scroller) return { error: 'no-scroller' };
    scroller.scrollTop = scroller.scrollHeight;
    return { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight };
  })()`);
  const loadedAll = await waitFor(async () => ((await liCount()) === inv0.notes + SEED ? true : null), 24, 300);
  record(
    'S1 无限滚动:首屏 50 条 + 滚到底自动加载到全部 61 条',
    first === true && loadedAll === true && !scrolled.error,
    `首屏=${first} 滚到底=${loadedAll} 滚动=${JSON.stringify(scrolled)} 实际条数=${await liCount()}`
  );
} finally {
  for (const id of seeded) await call('delete_note', { id });
  await evalIn(`location.reload()`);
  await sleep(3000);
  const inv1 = await inventory();
  const leftovers = inv1.ids.filter((x) => !inv0.ids.includes(x));
  record(
    'S2 测试数据删净 + 库存前后一致(笔记 id 清单 / 标签路径 / 视图数)',
    inv1.notes === inv0.notes && inv1.views === inv0.views && JSON.stringify(inv1.paths) === JSON.stringify(inv0.paths) && leftovers.length === 0,
    `notes ${inv1.notes}/${inv0.notes} views ${inv1.views}/${inv0.views} 残留=${JSON.stringify(leftovers)} paths同=${JSON.stringify(inv1.paths) === JSON.stringify(inv0.paths)}`
  );
}

finish();
close();
