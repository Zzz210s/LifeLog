#!/usr/bin/env node
/**
 * 表达式逃生舱 Task 5/6 的 CDP 端到端验收(六条读数)。
 * 前置:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm tauri dev
 * node scripts/dev-cdp-accept-expr.mjs [--phase=main|restart|cleanup]
 *   main = 读数 1-5 并记录库存基线(基线落 .superpowers/expr6/);restart 前需重启 dev;cleanup = 删净自建数据 + 前后对照。
 * 数据安全:自建对象一律带标记「验收六」(笔记正文 / 视图标题 / 标签根 验收6),cleanup 逐个删净并还原 filter_last 原文。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bindMain, conditions, open, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { HELPERS } from './dev-cdp-expr-ui.mjs';

const OUT = '.superpowers/expr6';
const MARK = '验收六';
const VIEW = '验收六视图';
const E3A = '#工作 AND NOT #临时';
const E3 = '(#工作 OR #生活) AND NOT #临时';
const E5 = '#验收6/项目A OR #验收6/项目B';
const E5R = '#验收6/项目X OR #验收6/项目B';
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

/** 读数 1-2:实时校验的绿色预览与红色错误(+1 展示、0 起光标) */
async function read12() {
  await x('openExpr()');
  await x('fillExpr(' + j(E3) + ')');
  const s1 = await waitX('status()', (v) => v && v.kind === 'ok');
  record('读数1 合法表达式实时通过并给中文预览', !!s1 && s1.text.startsWith('预览:'), j(s1));
  await x('fillExpr(' + j('#工作 AND') + ')');
  const s2 = await waitX('status()', (v) => v && v.kind === 'err');
  const ok = !!s2 && s2.text === '第 7 个字符:缺少操作数' && s2.danger === true && s2.sel[0] === 7 && s2.sel[1] === 7;
  record('读数2 非法表达式红框 + 「第 7 个字符:缺少操作数」+ 光标落点', ok, j(s2));
}

/**
 * 读数 3:chips/摘要显示原文;命中集合与等价结构化条件逐 id 一致 ——
 * OR 用两条 tags 查询的并集减 excludeTags,AND 用单个 tags+excludeTags 条件对象。
 */
async function read3() {
  await x('fillExpr(' + j(E3) + ')');
  await waitX('status()', (v) => v && v.kind === 'ok');
  await x("clickIn('表达式','确定')");
  const chips = await waitX('chips()', (c) => c && has(c, (y) => y.label.startsWith('表达式:')));
  const sum = await x('summary()');
  const dom = await x('texts()');
  const orRows = await rows({ expr: E3 });
  const uni = [];
  for (const p of ['工作', '生活']) uni.push(...ids(await rows({ tags: [{ path: p, includeChildren: true }] })));
  const notRows = ids(await rows({ tags: [{ path: '临时', includeChildren: true }] }));
  const union = [...new Set(uni)].filter((id) => !notRows.includes(id)).sort((a, b) => a - b);
  const andExpr = ids(await rows({ expr: E3A }));
  const struct = ids(await rows({ tags: [{ path: '工作', includeChildren: true }], excludeTags: [{ path: '临时', includeChildren: true }] }));
  const domOk = orRows.length === dom.length && orRows.every((n) => has(dom, (t) => norm(t) === norm(n.content)));
  const ok = !!chips && !!sum && sum.text.includes(E3) && same(ids(orRows), union) && same(andExpr, struct) && domOk;
  record('读数3 chips/摘要显示原文;OR 与结构化并集、AND 与 tags+excludeTags 逐 id 一致', ok,
    j({ chips: chips && chips.map((c) => c.label), sum, dom, exprOr: ids(orRows), union, exprAnd: andExpr, struct, domOk }));
  return chips;
}

/** 读数 4:点表达式 chip 再编辑、Esc 不保存(改过的文本丢弃)、删除 chip 后条件消失 */
async function read4(before) {
  await x("clickChipButton('编辑条件')");
  const opened = await waitX('exprValue()', (v) => v !== null, 8);
  await x('fillExpr(' + j('#生活') + ')');
  await waitX('status()', (v) => v && v.kind === 'ok');
  await x('esc()');
  const closed = await waitX('exprValue()', (v) => v === null, 8);
  const kept = same(await x('chips()'), before);
  await x("clickChipButton('编辑条件')");
  const reopen = await waitX('exprValue()', (v) => v !== null, 8);
  await x("clickIn('表达式','取消')");
  await x("clickChipButton('移除条件')");
  const gone = await waitX('chipArea()', (v) => v === false, 8);
  record('读数4 表达式 chip 可再编辑 / Esc 不保存 / 删除该项后条件消失',
    opened === E3 && closed === null && kept && reopen === E3 && gone === false, j({ opened, closed, kept, reopen, gone }));
}

/** 读数 5:保存为视图 -> 改名级联跟随 -> 删标签后行内失效提示且文本不变 */
async function read5() {
  await x('openExpr()');
  await x('fillExpr(' + j(E5) + ')');
  await waitX('status()', (v) => v && v.kind === 'ok');
  await x("clickIn('表达式','确定')");
  await waitX('chipArea()', Boolean);
  await x('saveView(' + j(VIEW) + ')');
  const id = await waitFor(async () => {
    const v = (await listViews()).find((v) => v.title === VIEW);
    return v ? v.id : null;
  });
  if (id === null) return record('读数5 保存为视图', false, '视图未落库');
  const v0 = (await listViews()).find((v) => v.id === id);
  await x('ensureTag(' + j('验收6/项目A') + ')');
  await x('renameTag(' + j('验收6/项目A') + ',' + j('项目X') + ')');
  const renamed = await waitFor(async () => has((await listTags()).map((t) => t.path), (p) => p === '验收6/项目X'));
  const v1 = (await listViews()).find((v) => v.id === id);
  const chips1 = await x('applyViewFor(' + id + ',' + j('验收6/项目X') + ')');
  record('读数5a 保存为视图 + 标签改名后视图条件表达式文本跟随(库 + UI)',
    !!renamed && v0.conditions.expr === E5 && v1.conditions.expr === E5R && !!chips1,
    j({ id, renamed, before: v0.conditions.expr, after: v1.conditions.expr, chips: chips1 && chips1.map((c) => c.label) }));

  await x('ensureTag(' + j('验收6/项目B') + ')');
  const del = await x('deleteTag(' + j('验收6/项目B') + ')');
  const v2 = await waitFor(async () => {
    const v = (await listViews()).find((v) => v.id === id);
    return v && v.broken_paths.length > 0 ? v : null;
  });
  const row = await waitX('viewRow(' + id + ')', (r) => r && r.broken, 16);
  const b = row && row.broken;
  record('读数5b 删除标签后视图行出现失效提示且表达式文本不变',
    del === true && !!v2 && v2.conditions.expr === E5R && v2.broken_paths.join('、') === '验收6/项目B' &&
      !!b && b.paths === '验收6/项目B' && b.title === '引用了已不存在的标签: 验收6/项目B',
    j({ del, expr: v2 && v2.conditions.expr, broken: v2 && v2.broken_paths, row: b }));
  await sleep(900); // 等 filter_last 节流落盘(读数 6 依赖)
  record('库存快照(主阶段结束,含自建数据)', true, j(await inventory()));
}

/** 读数 6:重启后条件与视图(含失效提示)仍在 */
async function readRestart() {
  const chips = await waitX('chips()', (c) => c && has(c, (y) => y.label === '表达式:' + E5R), 16);
  const v = (await listViews()).find((v) => v.title === VIEW);
  const row = v && (await x('viewRow(' + v.id + ')'));
  const b = row && row.broken;
  record('读数6 重启后表达式条件与视图(含失效提示)仍在',
    !!chips && !!b && b.title === '引用了已不存在的标签: 验收6/项目B' && !!v && v.conditions.expr === E5R,
    j({ chips: chips && chips.map((c) => c.label), expr: v && v.conditions.expr, row: b }));
}

/** 清收:删净自建笔记/标签/视图,还原 filter_last,并给库存前后对照 */
async function cleanup() {
  const before = JSON.parse(readFileSync(join(OUT, 'inventory-before.json'), 'utf8'));
  const orig = JSON.parse(readFileSync(join(OUT, 'filter-last-before.json'), 'utf8'));
  const chips = await x('chips()');
  if (has(chips, (c) => c.label.startsWith('表达式:'))) {
    await x("clickChipButton('移除条件')");
    await sleep(900);
  }
  for (const n of await rows({ keyword: MARK })) await call('delete_note', { id: n.id });
  const mine = (await listTags()).map((t) => t.path)
    .filter((p) => p.startsWith('验收6') || p === '临时')
    .sort((a, b) => b.length - a.length); // 深的先删(根级删除会级联子树)
  for (const p of mine) {
    const tag = (await listTags()).find((t) => t.path === p);
    if (tag) await call('delete_tag', { tagId: tag.id });
  }
  for (const v of (await listViews()).filter((v) => v.title === VIEW)) await call('delete_view', { id: v.id });
  await call('set_setting', { key: 'filter_last', value: orig });
  await sleep(1000);
  const after = await inventory();
  const fl = await call('get_setting', { key: 'filter_last' });
  const restored = same(before, after) && same(fl, orig);
  record('库存前后对照:笔记 id 清单 / 全部标签路径 / 视图列表 / filter_last 原文均还原', restored,
    j({ notes: [before.ids.length, after.ids.length], paths: [before.paths.length, after.paths.length], views: [before.views, after.views], filterLastRestored: same(fl, orig), before, after }));
}

if (phase === 'main') {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'inventory-before.json'), JSON.stringify(await inventory()));
  writeFileSync(join(OUT, 'filter-last-before.json'), JSON.stringify(await call('get_setting', { key: 'filter_last' })));
  const made = [];
  made.push((await call('save_input_note', { content: '#临时 ' + MARK + '临时笔记' })).id);
  made.push((await call('save_input_note', { content: '#验收6/项目A ' + MARK + '甲' })).id);
  made.push((await call('save_input_note', { content: '#验收6/项目B ' + MARK + '乙' })).id);
  record('准备:新建 3 条测试笔记(带 临时 / 验收6/项目A / 验收6/项目B 标签)', true, j(made));
  await sleep(500);
  await read12();
  const chips = await read3();
  await read4(chips);
  await read5();
} else if (phase === 'restart') {
  await readRestart();
} else if (phase === 'cleanup') {
  await cleanup();
} else {
  throw new Error('未知阶段:' + phase);
}
finish();
close();
