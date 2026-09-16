#!/usr/bin/env node
/**
 * 视图图标(E3)阶段 CDP 验收:场景 A-G + 迁移列读数。
 * 前置:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm tauri dev
 * node scripts/dev-cdp-accept-icon.mjs --phase=main|restart|cleanup
 *   main    = 基线洁净审计(不干净即中止)-> A 新建带图标 / B 重开回填 / C 清空 / D 内置固定图标
 *             / G 脏名字直写库 / F 迁移列读数 -> 落运行清单
 *   restart = 重启 dev 实例后读回图标(E);cleanup = 按清单删净 + 还原 filter_last + 收尾断言
 * 分工与口径:页面动作在 dev-cdp-icon-ui.mjs,数据安全(审计/清单/清收/直写库)在 dev-cdp-icon-clean.mjs;
 * 断言用“基线洁净 + 运行清单交集为空”(不用 before == after,避免把污染当基线)。
 */
import { mkdirSync } from 'node:fs';
import { bindMain, open, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { HELPERS } from './dev-cdp-icon-ui.mjs';
import {
  OUT, V1, V2, V3, auditBaseline, cleanupRun, dbProbe, readManifest, setIconDirect, writeJson,
} from './dev-cdp-icon-clean.mjs';

const phase = (process.argv.find((a) => a.startsWith('--phase=')) || '--phase=main').slice('--phase='.length);
const { record, finish } = recorder();
const { cdp, close } = await open('main');
const { call, inventory } = bindMain(cdp);
const j = JSON.stringify;
const listViews = () => call('list_views');

/** 注入页面侧动作库(window.__X) */
const inject = () => cdp.eval(HELPERS);
/** 调 window.__X.<expr>(失败不抛,便于 reload 期间轮询) */
const px = async (expr) => {
  try {
    return await cdp.eval('window.__X.' + expr);
  } catch {
    return undefined;
  }
};
/** 等页面收敛:pred 为真返回该值,超时 undefined;tries*250ms 为上限 */
const waitX = (expr, pred, tries = 24) =>
  waitFor(async () => {
    const v = await px(expr);
    return pred(v) ? { v } : null;
  }, tries, 250).then((r) => (r ? r.v : undefined));
const hasCls = (cls, name) => typeof cls === 'string' && cls.split(/\s+/).includes('lucide-' + name);
const viewIcon = async (id) => (await listViews()).find((v) => v.id === id)?.icon ?? 'MISSING';

/** 场景 A:顶栏「保存为视图」+ 网格选图标 -> 侧栏行即时出现并带图标 */
async function createWithIcon(title, icon) {  await px('openSave()');
  await waitX('dialogOpen("保存为视图")', (v) => v === true);
  await px('setTitle(' + j(title) + ')');
  const picked = await px('pickIcon(' + j(icon) + ')');
  const checked = await px('pickedIcon()');
  const t0 = Date.now();
  await px('clickDialog("保存")');
  const row = await waitX('row(' + j(title) + ')', (v) => v !== null, 6); // 回归:保存后侧栏 1.5s 内出现该行
  return { picked, checked, row, elapsedMs: Date.now() - t0 };
}

/** 场景 D:内置三行固定图标、无编辑入口 */
async function checkBuiltins() {
  const want = [['all', 'inbox'], ['todo', 'list-checks'], ['untagged', 'tags']];
  const got = [];
  for (const [key, icon] of want) {
    const r = await px('builtin(' + j(key) + ')');
    got.push({ key, icon, svg: r && r.svg, editEntry: r && r.editEntry });
  }
  const keys = await px('builtinKeys()');
  const ok = want.every(([key, icon]) => {
    const g = got.find((x) => x.key === key);
    return g && hasCls(g.svg, icon) && g.editEntry === false;
  });
  record('D 内置三视图固定图标(inbox/list-checks/tags)且行内无「设置图标」入口', ok && keys.length === 3, j({ keys, got }));
  record('D2 内置行不属自建视图(data-view-id 数 = 自建视图数)',
    (await px('rows()')).length === (await listViews()).length, j({ rows: (await px('rows()')).length }));
}

async function runMain() {
  mkdirSync(OUT, { recursive: true });
  const base = await inventory();
  const problems = auditBaseline(base);
  record('基线洁净审计:笔记首行 / 标签路径 / 视图标题 / filter_last 引用都无 AI 残留',
    problems.length === 0, j({ problems, notes: base.notes, views: base.views }));
  if (problems.length > 0) {
    console.log('基线不干净,中止(main 阶段拒绝把污染当基线)');
    finish();
    close();
    process.exit(1);
  }
  writeJson('inventory-before.json', base);
  // 起点归零:整页重载后再读数,保证 DOM 与库一致(上一次运行/手工调试残留的侧栏行会被清掉)
  await cdp.eval('location.reload()');
  await sleep(1500);
  await inject();
  await waitFor(async () => (await px('sidebar()')) !== undefined, 24, 250);
  if (!(await px('sidebar()'))) {
    record('前置:侧栏当时隐藏,已点顶栏「显示侧栏」入口(清收时会记回基线值)', await px('showSidebar()') === true, '');
    await waitX('sidebar()', (v) => v === true);
  } else {
    record('前置:侧栏可见', true, j({ sidebar: true }));
  }

  await checkBuiltins();

  // A 新建 V1 带图标 star
  const a = await createWithIcon(V1, 'star');
  const id1 = a.row && a.row.id;
  record('A 顶栏保存视图 + 选图标:侧栏出现该行且带 lucide-star 图标',
    !!a.row && a.picked === true && a.checked === 'star' && hasCls(a.row.svg, 'star') && a.row.attr === 'star',
    j({ ...a, svg: a.row && a.row.svg, attr: a.row && a.row.attr }));
  record('A2 库内 icon 已写入(create_view 带 icon)', (await viewIcon(id1)) === 'star', j({ id: id1, icon: await viewIcon(id1) }));

  // B 重开编辑对话框回填
  await px('openEdit(' + j(V1) + ')');
  await waitX('dialogOpen("编辑视图")', (v) => v === true);
  const titleVal = await px('titleValue()');
  const picked = await px('pickedIcon()');
  const gridSize = await px('gridSize()');
  record('B 重开编辑对话框:标题回填 + 图标高亮在 star + 网格含「无图标」项',
    titleVal === V1 && picked === 'star' && gridSize === 42, j({ titleVal, picked, gridSize }));
  await px('clickDialog("取消")');
  await waitX('dialogOpen("编辑视图")', (v) => v === false);

  // A2' 新建 V2 带图标 tag(供清空场景)
  const b = await createWithIcon(V2, 'tag');
  const id2 = b.row && b.row.id;
  record('A3 第二个视图带 tag 图标落位', !!b.row && hasCls(b.row.svg, 'tag') && b.row.attr === 'tag',
    j({ id: id2, svg: b.row && b.row.svg }));

  // C 清空图标:行内不再有图标,标题左偏移与带图标的 V1 一致(固定 w-4 容器,不跳)
  await px('openEdit(' + j(V2) + ')');
  await waitX('dialogOpen("编辑视图")', (v) => v === true);
  const clearPicked = await px('pickIcon("无图标")');
  const afterClearPicked = await px('pickedIcon()');
  await px('clickDialog("保存")');
  const v2row = await waitX('row(' + j(V2) + ')', (r) => r !== null && r.svg === null);
  const rows = await px('rows()');
  const r1 = rows.find((r) => r.id === id1);
  const r2 = rows.find((r) => r.id === id2);
  record('C 清空图标:行内不再渲染图标(attr 空、无 svg)',
    clearPicked === true && afterClearPicked === '无图标' && !!v2row && v2row.attr === '' && v2row.svg === null,
    j({ v2row, afterClearPicked }));
  record('C2 标题位置不跳(带图标与无图标的行标题左偏移相同)', !!r1 && !!r2 && r1.left === r2.left,
    j({ withIcon: r1 && r1.left, withoutIcon: r2 && r2.left }));

  // G 脏名字:绕过命令层直接写库 icon='bogus'(白名单外),界面不崩、不渲染图标
  const c = await createWithIcon(V3, '无图标');
  const id3 = c.row && c.row.id;
  record('G0 第三个视图默认无图标(新建时网格默认选中「无图标」)', c.checked === '无图标' && !!c.row && c.row.svg === null,
    j({ id: id3, checked: c.checked }));
  const wrote = setIconDirect(id3, 'bogus');
  record('G1 直写库 icon=\'bogus\' 已落库(库内读回)', wrote === 'bogus', j({ wrote }));
  await cdp.eval('location.reload()');
  await sleep(1500);
  await inject(); // 重载会清掉页面助手,必须重新注入再读数
  await waitFor(async () => (await px('rows()'))?.length >= 3, 24, 250);
  const afterReload = (await px('rows()')) || [];
  const g = afterReload.find((r) => r.id === id3);
  record('G2 重载后页面不崩且行数不变(3 个自建视图)',
    afterReload.length === 3 && typeof (await px('bodyText()')) === 'string', j({ rows: afterReload.length }));
  record('G3 白名单外的名字不渲染图标(attr 保留脏名字、svg 为 null)',
    !!g && g.attr === 'bogus' && g.svg === null, j({ dirty: g }));

  // F 迁移 010 已在真实库执行
  const probe = dbProbe();
  record('F 真实库迁移 010:user_version = 10 且 saved_views 含可空 icon 列',
    probe.version === 10 && !!probe.icon && probe.icon.notnull === 0, j(probe));

  const man = { viewIds: [id1, id2, id3].filter((v) => typeof v === 'number'), titles: [V1, V2, V3], filterLastBefore: base.filterLast };
  writeJson('run-manifest.json', man);
  console.log('INFO 运行清单已落盘 ' + j(man));
  console.log('INFO 库存快照(主阶段结束,含自建数据)' + j(await inventory()));
}

/** 场景 E:重启 dev 实例后图标仍在(V1 star / V2 无 / V3 脏名字不渲染) */
async function runRestart() {
  const man = readManifest();
  await inject();
  await waitFor(async () => (await px('rows()'))?.length >= 3, 24, 250);
  const rows = (await px('rows()')) || [];
  const [id1, id2, id3] = man.viewIds;
  const r1 = rows.find((r) => r.id === id1);
  const r2 = rows.find((r) => r.id === id2);
  const r3 = rows.find((r) => r.id === id3);
  record('E 重启后图标仍在:V1 仍是 lucide-star、V2 仍无图标', !!r1 && hasCls(r1.svg, 'star') && !!r2 && r2.svg === null,
    j({ v1: r1, v2: r2 }));
  record('E2 重启后脏名字仍不渲染且页面正常', !!r3 && r3.attr === 'bogus' && r3.svg === null && rows.length === 3,
    j({ v3: r3, rows: rows.length }));
  console.log('INFO 重启阶段库存' + j(await inventory()));
}

if (phase === 'main') {
  await runMain();
} else if (phase === 'restart') {
  await runRestart();
} else if (phase === 'cleanup') {
  await cleanupRun({ call, listViews, inventory, record, j });
} else {
  throw new Error('未知阶段:' + phase);
}
finish();
close();
