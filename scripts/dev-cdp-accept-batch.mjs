#!/usr/bin/env node
/**
 * 本批次新能力的 CDP 端到端验收:时间标签(P3)/ 改名与数据目录迁移(P2)。
 * 标签拖拽(P1)单独在 scripts/dev-cdp-accept-drag.mjs;主题(P4)在 scripts/dev-cdp-accept-theme.mjs。
 * 用法: node scripts/dev-cdp-accept-batch.mjs   (先以 9222 调试端口启动 pnpm tauri dev)
 * 自建自删测试数据:末尾用「库存前后对照」(笔记 id 清单 + 全部标签路径 + 视图数)+
 * 旧数据目录逐文件 sha256 证明真实库与旧目录均被还原。
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, recorder, sleep, conditions, bindMain } from './cdp-lib.mjs';

const { record, finish } = recorder();
const OLD_DIR = 'C:/Users/23652/AppData/Roaming/app.lifelog';
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const [Y, M, D] = [String(now.getFullYear()), pad(now.getMonth() + 1), pad(now.getDate())];
const TODAY = `${Y}-${M}-${D}`;
const TODAY_PATH = `时间排序/${Y}/${M}/${D}`;
const NEW_DATE = '2026-05-20';
const NEW_TAG = '时间排序/2026/05/20';
const TEST_NOTE = 'P5时间标签验收';
const samePaths = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const snapshot = (dir) =>
  readdirSync(dir)
    .sort()
    .map((f) => f + ':' + createHash('sha256').update(readFileSync(join(dir, f))).digest('hex').slice(0, 12))
    .join('|');

const { cdp, close } = await open('main');
const { call, hits, paths, liCount, inventory } = bindMain(cdp);

const oldBefore = snapshot(OLD_DIR);
const inv0 = await inventory();
const workBefore = (await call('list_tags')).find((t) => t.path === '工作').subtree_count;
console.log('验收前库存:', JSON.stringify({ notes: inv0.notes, views: inv0.views, tagPaths: inv0.paths.length }), '旧目录文件', readdirSync(OLD_DIR).length);

// ================= A 时间标签 =================
const note = await call('save_input_note', { content: TEST_NOTE });
const myTimeTags = (note.tags || []).filter((t) => t.startsWith('时间排序/'));
record(
  'A1 新建笔记自动挂当天时间标签且只有一个',
  myTimeTags.length === 1 && myTimeTags[0] === TODAY_PATH && (note.date || '') === TODAY,
  `id=${note.id} tags=${JSON.stringify(note.tags)} date=${note.date}`
);
await sleep(700);
const timeUi = await cdp.eval(`(() => {
  const list = document.querySelector('[data-testid="time-list"]');
  const rows = list ? Array.from(list.querySelectorAll('[data-time-path]')).map((r) => r.getAttribute('data-time-path')) : null;
  const row = list ? list.querySelector('[data-time-path="' + ${JSON.stringify(TODAY_PATH)} + '"]') : null;
  return { rows, todayText: row ? row.textContent.trim() : null };
})()`);
record(
  'A2 侧栏时间分区按 时间排序/年/月/日 成树',
  Array.isArray(timeUi.rows) && ['时间排序', `时间排序/${Y}`, `时间排序/${Y}/${M}`, TODAY_PATH].every((p) => timeUi.rows.includes(p)),
  `今天行=${timeUi.todayText} 行数=${(timeUi.rows || []).length} 末三行=${(timeUi.rows || []).slice(-3).join(',')}`
);
await cdp.eval(`document.querySelector('[data-time-path="' + ${JSON.stringify(TODAY_PATH)} + '"]').click()`);
await sleep(800);
const picked = await cdp.eval(`(() => ({
  count: document.querySelectorAll('li .md-body').length,
  chips: Array.from(document.querySelectorAll('[aria-label^="移除条件"]')).map((b) => b.getAttribute('aria-label')),
}))()`);
record('A3 点日行按该日筛选(只命中当天那 1 条)', picked.count === 1, JSON.stringify(picked));
await cdp.eval(`(() => { const b = document.querySelector('[aria-label^="移除条件"]'); if (b) b.click(); return true; })()`);
await sleep(600);
record('A4 移除条件后恢复全量(含新笔记 7 条)', (await liCount()) === inv0.notes + 1, `列表 ${await liCount()}/${inv0.notes + 1}`);

// 改期走真实 UI:点笔记行日期 -> 原生日期控件输入新日期并提交
const changedUi = await cdp.eval(`(async () => {
  const tick = () => new Promise((r) => setTimeout(r, 120));
  const row = Array.from(document.querySelectorAll('li')).find((li) => li.textContent.includes(${JSON.stringify(TEST_NOTE)}));
  if (!row) return { error: 'no-row' };
  const btn = row.querySelector('button[aria-label="修改日期"]');
  const before = btn ? btn.textContent.trim() : null;
  btn.click();
  await tick();
  const input = row.querySelector('input[aria-label="选择日期"]');
  if (!input) return { error: 'no-input', before };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(NEW_DATE)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
  return { before };
})()`);
await sleep(1200);
const mine = (await call('query_notes', { conditions: conditions({}), offset: 0 })).find((n) => n.id === note.id);
const newTimeTags = (mine.tags || []).filter((t) => t.startsWith('时间排序/'));
const oldHits = await hits({ tags: [{ path: TODAY_PATH, includeChildren: true }] });
const newHits = await hits({ tags: [{ path: NEW_TAG, includeChildren: true }] });
const timeRowPaths = (await call('list_tags')).filter((t) => t.path.startsWith('时间排序')).map((t) => t.path);
record(
  'A5 UI 改期后库内只剩一个时间标签(新日期,旧日标签已清)',
  changedUi.before === TODAY && newTimeTags.length === 1 && newTimeTags[0] === NEW_TAG && mine.date === NEW_DATE && oldHits === 0 && newHits === 1 && !timeRowPaths.includes(TODAY_PATH),
  `行内日期 ${changedUi.before} -> ${mine.date} tags=${JSON.stringify(newTimeTags)} 旧日命中=${oldHits} 新日命中=${newHits} 时间行=${JSON.stringify(timeRowPaths)}`
);
const dateUi = await cdp.eval(`(() => {
  const list = document.querySelector('[data-testid="time-list"]');
  const rows = list ? Array.from(list.querySelectorAll('[data-time-path]')).map((r) => r.getAttribute('data-time-path')) : [];
  const cells = Array.from(document.querySelectorAll('button[aria-label="修改日期"]')).map((b) => b.textContent.trim());
  return { hasNew: rows.includes(${JSON.stringify(NEW_TAG)}), cells };
})()`);
record(
  'A6 侧栏时间分区与笔记行同步显示改后日期',
  dateUi.hasNew && dateUi.cells.includes(NEW_DATE),
  `时间分区含新行=${dateUi.hasNew} 行内日期=${JSON.stringify(dateUi.cells)}`
);

// ================= B 改名与数据目录迁移 =================
const dbinfo = await call('get_db_info');
const title = await cdp.eval('document.title');
const topName = await cdp.eval(`(() => { const h = document.querySelector('header span'); return h ? h.textContent.trim() : null; })()`);
record(
  'B1 数据目录为 com.lifelog.app 且库可读(笔记数 = 验收前 + 1)',
  dbinfo.path.includes('com.lifelog.app') && dbinfo.path.endsWith('lifelog.db') && dbinfo.notes === inv0.notes + 1,
  JSON.stringify(dbinfo)
);
record('B2 主窗页面标题与顶栏应用名为 拾枝', title === '拾枝' && topName === '拾枝', `title=${title} 顶栏=${topName}`);
const oldAfter = snapshot(OLD_DIR);
record(
  'B3 旧数据目录 app.lifelog 未被改动(逐文件 sha256 一致)',
  oldAfter === oldBefore,
  `文件数=${readdirSync(OLD_DIR).length} 快照一致=${oldAfter === oldBefore}`
);

// ================= D 清理与库存对照 =================
await call('delete_note', { id: note.id });
await sleep(800);
const inv1 = await inventory();
record(
  'D1 测试数据删净 + 库存前后一致(笔记 id 清单 / 标签路径 / 视图数)',
  inv1.notes === inv0.notes && samePaths(inv1.ids, inv0.ids) && samePaths(inv1.paths, inv0.paths) && inv1.views === inv0.views,
  `notes ${inv1.notes}/${inv0.notes} ids同=${samePaths(inv1.ids, inv0.ids)} paths同=${samePaths(inv1.paths, inv0.paths)} views ${inv1.views}/${inv0.views}`
);
record('D2 旧数据目录仍与验收前逐文件一致', snapshot(OLD_DIR) === oldBefore, `文件数=${readdirSync(OLD_DIR).length}`);

finish();
close();

