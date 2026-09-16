#!/usr/bin/env node
/**
 * 表达式逃生舱 Task 5/6 的 CDP 端到端验收(读数 1-6 + 四条补齐断言)。
 * 前置:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm tauri dev
 * node scripts/dev-cdp-accept-expr.mjs [--phase=main|restart|cleanup]
 *   main    = 基线洁净审计(不干净立即中止)-> 读数 1-5 -> 落 run-manifest.json
 *   restart = 重启 dev 后读回条件与视图(读数 6)
 *   cleanup = 按运行清单删净自建数据 + 还原 filter_last + 三项收尾断言
 * 分工:本文件只做接线与库存快照;读数场景在 dev-cdp-accept-expr-scene.mjs,
 * 数据安全(基线审计/运行清单/清收)在 dev-cdp-accept-expr-clean.mjs。
 * 断言口径由"库存前后全等"(会把污染当基线)改为"运行清单交集为空"(只证明删净自己)。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bindMain, conditions, open, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { HELPERS } from './dev-cdp-expr-ui.mjs';
import { FIXTURES, createReadings } from './dev-cdp-accept-expr-scene.mjs';
import { OUT, RUN_ROOT, auditBaseline, cleanupRun } from './dev-cdp-accept-expr-clean.mjs';

const phase = (process.argv.find((a) => a.startsWith('--phase=')) || '--phase=main').slice('--phase='.length);

const { record, finish } = recorder();
const { cdp, close } = await open('main');
const { call, inventory } = bindMain(cdp);
await cdp.eval(HELPERS);
const x = (js) => cdp.eval('window.__X.' + js);
const j = JSON.stringify;
const has = (a, f) => a.some(f);
const ids = (rows) => rows.map((n) => n.id).sort((a, b) => a - b);
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const same = (a, b) => j(a) === j(b);
const listTags = () => call('list_tags');
const listViews = () => call('list_views');
const rows = (over) => call('query_notes', { conditions: conditions(over), offset: 0 });
/** 等页面收敛:pred 为真时返回该值(值可为 null/false);超时返回 undefined */
const waitX = (js, pred, tries = 24) =>
  waitFor(async () => { const v = await x(js); return pred(v) ? { v } : null; }, tries, 250).then((r) => (r ? r.v : undefined));

const readings = createReadings({ x, j, record, call, rows, listTags, listViews, waitX, waitFor, has, ids, norm, same });

/** main 阶段:先证基线干净,再自建夹具跑读数,最后把自己的数据写进运行清单 */
async function runMain() {
  mkdirSync(OUT, { recursive: true });
  const base = await inventory();
  const problems = auditBaseline(base);
  record('基线洁净审计:笔记首行 / 标签路径 / 视图标题 / filter_last 引用都无 AI 残留', problems.length === 0, j({ problems, base }));
  if (problems.length > 0) {
    console.log('基线不干净,中止(main 阶段拒绝把污染当基线)');
    finish();
    close();
    process.exit(1);
  }
  writeFileSync(join(OUT, 'inventory-before.json'), JSON.stringify(base, null, 2));
  const made = [];
  for (const content of FIXTURES) made.push((await call('save_input_note', { content })).id);
  console.log('INFO 准备:新建 ' + made.length + ' 条测试笔记 ' + j(made) + '(不计入通过数)');
  await sleep(700);
  await readings.read12();
  const chips = await readings.read3(made[2]);
  await readings.read3b(chips);
  await readings.read4(chips);
  const viewId = await readings.read5();
  const tagPaths = (await listTags()).map((t) => t.path)
    .filter((p) => p === RUN_ROOT || p.startsWith(RUN_ROOT + '/'));
  const man = { noteIds: made, tagPaths, viewIds: viewId === null ? [] : [viewId], filterLastBefore: base.filterLast };
  writeFileSync(join(OUT, 'run-manifest.json'), JSON.stringify(man, null, 2));
  console.log('INFO 运行清单已落盘 ' + j(man));
  console.log('INFO 库存快照(主阶段结束,含自建数据)' + j(await inventory()));
}

if (phase === 'main') {
  await runMain();
} else if (phase === 'restart') {
  await readings.readRestart();
} else if (phase === 'cleanup') {
  await cleanupRun({ call, listTags, listViews, inventory, x, record, j });
} else {
  throw new Error('未知阶段:' + phase);
}
finish();
close();
