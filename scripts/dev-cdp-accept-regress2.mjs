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

// filter_current 会被前端按自己的规范形式回写一次(迁移遗留的平铺字段搬进 groups),故按语义归一
// (条件集合 + 组间关系 + 排序项)再比,不比原始字符串。
const canonFilter = (raw) => {
  if (raw == null) return null;
  const f = JSON.parse(raw);
  const items = [];
  const norm = (it) => {
    const o = { kind: it.kind };
    if ('value' in it) o.value = it.value;
    if ('path' in it) o.path = it.path;
    if ('includeChildren' in it) o.includeChildren = !!it.includeChildren;
    return o;
  };
  const add = (op, it) => {
    if ((it.kind === 'keyword' || it.kind === 'expr') && !String(it.value ?? '').trim()) return;
    items.push(`${op === 'or' ? 'or' : 'and'}|${JSON.stringify(norm(it))}`);
  };
  const groups = Array.isArray(f.groups) && f.groups.length ? f.groups : [{ op: 'and', items: [
    ...((f.keyword ?? '').trim() ? [{ kind: 'keyword', value: f.keyword }] : []),
    ...(f.tags ?? []).map((t) => ({ kind: 'tag', path: t.path, includeChildren: !!t.includeChildren })),
    ...(f.excludeTags ?? []).map((t) => ({ kind: 'excludeTag', path: t.path, includeChildren: !!t.includeChildren })),
    ...(f.relations ?? []).map((r) => ({ kind: 'relation', path: r.path })),
    ...(f.excludeRelations ?? []).map((r) => ({ kind: 'excludeRelation', path: r.path })),
    ...(f.tagPresence ? [{ kind: 'presence', value: f.tagPresence }] : []),
    ...((f.expr ?? '').trim() ? [{ kind: 'expr', value: f.expr }] : []),
  ] }];
  for (const g of groups) for (const it of g.items ?? []) add(g.op, it);
  return JSON.stringify({ items: items.sort(), groupOp: f.groupOp === 'or' ? 'or' : 'and', sort: f.sort ?? null, sorts: f.sorts ?? [], groupBy: f.groupBy ?? null });
};

const { cdp, close } = await ensureMain();
const { call, liCount, inventory } = bindMain(cdp);
const { evalIn } = bindDom(cdp);

const inv0 = await inventory();
console.log('验收前库存:', JSON.stringify({ notes: inv0.notes, theme: inv0.theme, tagPaths: inv0.paths.length }));
// 信息流/导出共用同一份条件:settings.filter_current(缺省 = 空条件 = 全部实体)。
// 统一实体后 query_notes 的空条件不再等价于「老笔记集」,故显式取 filter_current 逐页读到全量,
// 排序固定 newest 以对齐 export_notes 的 ORDER BY id DESC。
const filterRaw = await call('get_setting', { key: 'filter_current' });
const streamCond = { ...(filterRaw ? JSON.parse(filterRaw) : conditions({})), sort: 'newest' };
const filtered0 = await (async () => {
  const out = [];
  for (let off = 0; ; ) { const p = await call('query_notes', { conditions: streamCond, offset: off }); out.push(...p); if (p.length < 50) return out; off += p.length; }
})();
console.log('信息流条件命中:', filtered0.length);

// ---------- E1 界面导出:命令面板 `>导出整库` -> 原生保存对话框出现并可取消 ----------
// 条件栏的「导出整库」按钮与顶栏 `⋯` 溢出菜单都已删(2026-10-07,见 shell/export-notice.dom.test.ts):
// 鼠标入口只剩命令面板,故这里走统一输入框里真实打命令的路径,再验原生保存框。
const menuPicked = await (async () => {
  const set = await evalIn(`(() => {
    const box = document.querySelector('[data-testid="unified-input"]');
    if (!box) return false;
    const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    s.call(box, '>导出整库');
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!set) return false;
  const listed = await waitFor(() => evalIn(`(() => {
    const lis = [...document.querySelectorAll('[data-testid="unified-dropdown"] li[role="option"]')];
    return lis.length > 0 && lis[0].textContent.includes('导出整库') ? lis[0].textContent.trim() : null;
  })()`), 20, 250);
  if (!listed) return false;
  await evalIn(`(() => { document.querySelector('[data-testid="unified-input"]')
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()`);
  return true;
})();
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
  'E1 命令面板「导出整库」弹出原生保存框(取消后状态条复位、无错误提示)',
  menuPicked === true && dlgSeen === true && closed.closed === true && dlgGone === true && afterCancel.busy === false && afterCancel.err === false,
  `命令跑起=${menuPicked} 原生框=${JSON.stringify({ seen: dlgSeen, title: dlgTitle, closed })} 复位=${JSON.stringify(afterCancel)}`
);

// ---------- E2 导出命令 + xlsx 结构校验(openpyxl 读回) ----------
if (existsSync(EXPORT)) unlinkSync(EXPORT);
await call('export_notes', { path: EXPORT });
const size = existsSync(EXPORT) ? statSync(EXPORT).size : 0;
const dump = py(`import json, openpyxl; wb = openpyxl.load_workbook(r'${EXPORT}');
ws = wb['条目'];
rows = [[c.value for c in r] for r in ws.iter_rows()];
print(json.dumps({'sheets': wb.sheetnames, 'header': rows[0], 'rows': rows[1:], 'count': len(rows) - 1}, ensure_ascii=False))`);
const xlsx = JSON.parse(dump);
const heads = filtered0.slice(0, 3).map((n) => String(n.content).split(String.fromCharCode(10))[0]);
const xlsxHeads = xlsx.rows.slice(0, 3).map((r) => String(r[1]).split(String.fromCharCode(10))[0]);
const refRows = xlsx.rows.map((r) => String(r[3] ?? '')).filter((s) => s.trim() !== '');
record(
  'E2 导出 xlsx 结构与内容(表头 id/正文/创建时间/引用路径,sheet 名「条目」/ 行数 = 当前筛选命中 / 前三条正文一致 / 引用列非空)',
  JSON.stringify(xlsx.sheets) === JSON.stringify(['条目']) &&
    JSON.stringify(xlsx.header) === JSON.stringify(['id', '正文', '创建时间', '引用路径']) &&
    xlsx.count === filtered0.length &&
    JSON.stringify(xlsxHeads) === JSON.stringify(heads) &&
    refRows.length > 0 &&
    size > 0,
  `sheet=${JSON.stringify(xlsx.sheets)} 表头=${JSON.stringify(xlsx.header)} 行数=${xlsx.count}/${filtered0.length} 前三条=${JSON.stringify(xlsxHeads)} 有引用列的行=${refRows.length} 文件=${size}B`
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
  const loadedAll = cur === filtered0.length + SEED ? true : null;
  record(
    'S1 无限滚动:首屏 50 条 + 滚到底逐页加载到全部(验收前笔记数 + 自建 55 条)',
    first === true && loadedAll === true && !scrolled.error,
    `首屏=${first} 滚到底=${loadedAll} 滚动=${JSON.stringify(scrolled)} 实际条数=${await liCount()} 期望=${filtered0.length + SEED}`
  );
} finally {
  for (const id of seeded) await call('delete_note', { id });
  await evalIn(`location.reload()`);
  await sleep(3000);
  const inv1 = await inventory();
  const leftovers = inv1.ids.filter((x) => !inv0.ids.includes(x));
  const filterSame = canonFilter(inv1.filterCurrent) === canonFilter(inv0.filterCurrent);
  record(
    'S2 测试数据删净 + 库存前后一致(笔记 id 清单 / 标签路径 / filter_current / theme)',
    inv1.notes === inv0.notes && filterSame && inv1.theme === inv0.theme && JSON.stringify(inv1.paths) === JSON.stringify(inv0.paths) && leftovers.length === 0,
    `notes ${inv1.notes}/${inv0.notes} filter_current同=${filterSame} theme ${inv1.theme}/${inv0.theme} 残留=${JSON.stringify(leftovers)} paths同=${JSON.stringify(inv1.paths) === JSON.stringify(inv0.paths)}`
  );
}

finish();
close();
