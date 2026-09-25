#!/usr/bin/env node
/**
 * 本批次新能力的 CDP 端到端验收:时间标签自动挂载(P3)/ 改名与数据目录迁移(P2)。
 * 标签拖拽(P1)单独在 scripts/dev-cdp-accept-drag.mjs;主题(P4)在 scripts/dev-cdp-accept-theme.mjs。
 * 用法: node scripts/dev-cdp-accept-batch.mjs   (先以 9222 调试端口启动 pnpm tauri dev;冷启动即可 —— 主窗由 ensureMain 前置自动打开)
 * 自建自删测试数据:末尾用「库存前后对照」(笔记 id 清单 + 全部标签路径 + filter_current + theme)+
 * 旧数据目录逐文件 sha256 证明真实库与旧目录均被还原。
 * 时间标签根名不写死:从设置 `time_tag_template` 推导(见 cdp-lib 的 timeTagRoot);
 * 侧栏独立「时间」分区已随时间标签降级删除,行内「改期」入口也已删(日期不可改),
 * 原先的 A2/A3/A4/A6 侧栏与改期用例已作废,时间标签按普通标签在库内/筛选侧取证。
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureMain, recorder, sleep, bindMain, timeTagRoot } from './cdp-lib.mjs';

const { record, finish } = recorder();
const OLD_DIR = 'C:/Users/23652/AppData/Roaming/app.lifelog';
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const [Y, M, D] = [String(now.getFullYear()), pad(now.getMonth() + 1), pad(now.getDate())];
const TODAY = `${Y}-${M}-${D}`;
const TEST_NOTE = 'P5时间标签验收';
const samePaths = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const day = (s) => String(s ?? '').slice(0, 10);
const snapshot = (dir) =>
  readdirSync(dir)
    .sort()
    .map((f) => f + ':' + createHash('sha256').update(readFileSync(join(dir, f))).digest('hex').slice(0, 12))
    .join('|');

const { cdp, close } = await ensureMain();
const { call, hits, inventory } = bindMain(cdp);

// 时间标签根名:真源是设置 time_tag_template(默认「时间排序/{y}/{m}/{d}」,真实库可能已改名)
const TIME_ROOT = await timeTagRoot(call);
if (!TIME_ROOT) {
  console.error('取不到时间标签根名(time_tag_template 为空或以 { 开头),中止');
  process.exit(2);
}
const TODAY_PATH = `${TIME_ROOT}/${Y}/${M}/${D}`;
const minePaths = (ts) => (ts || []).filter((t) => t === TIME_ROOT || t.startsWith(TIME_ROOT + '/'));

const oldBefore = snapshot(OLD_DIR);
const inv0 = await inventory();
console.log('验收前库存:', JSON.stringify({ notes: inv0.notes, theme: inv0.theme, tagPaths: inv0.paths.length }),
  '旧目录文件', readdirSync(OLD_DIR).length, '时间标签根名', TIME_ROOT);

// ================= A 时间标签(自动挂载) =================
// 该日命中数必须在建笔记「之前」读(建完再读就包含自己那一条,增量断言会变成恒等)
const oldHitsBefore = await hits({ tags: [{ path: TODAY_PATH, includeChildren: false }] });
const note = await call('save_input_note', { content: TEST_NOTE });
const myTimeTags = minePaths(note.tags);
record(
  'A1 新建笔记自动挂当天时间标签且只有一个',
  myTimeTags.length === 1 && myTimeTags[0] === TODAY_PATH && day(note.created_at) === TODAY,
  `id=${note.id} tags=${JSON.stringify(note.tags)} created_at=${note.created_at}`
);

// A2 自动时间标签是普通标签:库内标签表出现该日节点,按它筛选命中「建笔记前 + 1」
// (旧侧栏独立「时间分区」与「行内改期」两个入口都已删,故不再走 DOM;点侧栏日级标签筛选由
//  scripts/lifelog-sidebar-day-filter.mjs 覆盖)
const tagNode = (await call('list_tags')).some((t) => t.path === TODAY_PATH);
const pickedHits = await hits({ tags: [{ path: TODAY_PATH, includeChildren: false }] });
record(
  'A2 自动时间标签是普通标签(库内出现该日节点 + 按它筛选命中 +1)',
  tagNode === true && pickedHits === oldHitsBefore + 1,
  `库内节点=${tagNode} 按该日(仅本级)命中=${pickedHits}(建笔记前 ${oldHitsBefore})`
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
  'D1 测试数据删净 + 库存前后一致(笔记 id 清单 / 标签路径 / filter_current / theme)',
  inv1.notes === inv0.notes && samePaths(inv1.ids, inv0.ids) && samePaths(inv1.paths, inv0.paths) &&
    inv1.filterCurrent === inv0.filterCurrent && inv1.theme === inv0.theme,
  `notes ${inv1.notes}/${inv0.notes} ids同=${samePaths(inv1.ids, inv0.ids)} paths同=${samePaths(inv1.paths, inv0.paths)} filter_current同=${inv1.filterCurrent === inv0.filterCurrent} theme ${inv1.theme}/${inv0.theme}`
);
record('D2 旧数据目录仍与验收前逐文件一致', snapshot(OLD_DIR) === oldBefore, `文件数=${readdirSync(OLD_DIR).length}`);

finish();
close();
