// 时间标签降级(2026-09-17 spec)Step 3 阶段验收:dev + 真实库 + CDP。
// 用法:
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm tauri dev
//   node scripts/dev-cdp-accept-timetag.mjs     # 冷启动即可:主窗由 ensureMain 前置自动打开
// 本脚本只断言与读数,不清理;清理与复位见 scripts/dev-cdp-accept-timetag-clean.mjs。
import { statSync, writeFileSync } from 'node:fs';
import { ensureMain, open, sleep, waitFor, recorder } from './cdp-lib.mjs';
import { MARK, TPL_DEFAULT, TPL_ALT, SEL_SWITCH, SEL_TPL, EVIDENCE, EXPORT_PATH, actions, subtree, dayNodes, datePath } from './timetag-lib.mjs';

const r = recorder();
const { cdp: main, close: closeMain } = await ensureMain();
const { cdp: input, close: closeInput } = await open('input');
const a = actions(main, input);

// —— B0/B1 基线读数与内置视图口径 ——
const baseTags = await a.tagList();
const baseHits = Object.fromEntries(await a.call('count_view_hits'));
// 筛选条件原值:清理脚本要按它还原,而不是写死一个固定 JSON(否则会把用户当时的选择抹掉)
const filterLastBefore = await a.getSetting('filter_last');
const tRoot = subtree(baseTags, '时间排序');
const d = new Date();
const today = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
const dayLevel = dayNodes(baseTags, '时间排序').length;
r.record(
  'B0 基线:标签 570 / 时间子树 312 / 日级 275,全部命中 1357',
  baseTags.length === 570 && tRoot.length === 312 && dayLevel === 275 && baseHits.all === 1357,
  `tags=${baseTags.length} 时间子树=${tRoot.length} 日级=${dayLevel} hits=${JSON.stringify(baseHits)}`
);
r.record(
  'B1 内置视图:待办 = #待办 含子级排除 done(预期 286);无标签 = 无任何标签(预期 0)',
  baseHits.todo === 286 && baseHits.untagged === 0,
  `all=${baseHits.all} todo=${baseHits.todo} untagged=${baseHits.untagged}`
);

// —— 复核 Step 2 三项读数(其余引用 step2-report.md 第 5 节)——
await a.resetUi();
await waitFor(() => main.eval(`document.querySelectorAll('li .md-body').length > 0`), 25, 250);
const sidebar = await waitFor(
  () => main.eval(`(() => {
    const root = !!document.querySelector('[data-tag-path="时间排序"]');
    const year = !!document.querySelector('[data-tag-path="时间排序/2026"]');
    return root && year ? { root, year } : null;
  })()`),
  25,
  200
);
r.record('S2-1 侧栏标签区含 时间排序 根并展开到年(其余引用 Step 2 读数)', sidebar !== null, `根与年节点都在=${JSON.stringify(sidebar)}`);
await a.clickText('button', '添加条件');
await sleep(300);
const menu = await main.eval(`[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((e) => e.textContent).join('|')`);
await main.eval(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
r.record('S2-2 添加条件菜单无日期入口', menu.includes('排序') && menu.includes('表达式') && !menu.includes('日期'), `菜单项=${menu}`);
const settingsOpen1 = await a.openSettings();
const aria = await waitFor(
  () => main.eval(`(() => { const s = document.querySelector(${JSON.stringify(SEL_SWITCH)}); return s ? s.getAttribute('aria-checked') : null; })()`),
  20,
  200
);
const tplValue = await main.eval(`(() => { const i = document.querySelector(${JSON.stringify(SEL_TPL)}); return i ? i.value : null; })()`);
r.record('S2-3 设置页两控件存在(开关默认开 + 模板默认值)', settingsOpen1 === true && aria === 'true' && tplValue === TPL_DEFAULT, `分区已渲染=${settingsOpen1} aria-checked=${aria} 模板=${tplValue}`);

// —— A1/A2 开关关:新建笔记无自动标签 ——
await a.clickSel(SEL_SWITCH);
const offDb = await waitFor(() => a.getSetting('auto_time_tag').then((v) => (v === 'false' ? v : null)), 20, 200);
const offAria = await main.eval(`document.querySelector(${JSON.stringify(SEL_SWITCH)}).getAttribute('aria-checked')`);
r.record('A1 设置页关掉开关 -> 落库 false 且界面同态', offDb === 'false' && offAria === 'false', `库值=${offDb} aria-checked=${offAria}`);
await a.resetUi();
const cleared1 = await a.saveNote(`#${MARK} step3 自动标签关`);
const n1 = await a.findNote('step3 自动标签关');
r.record(
  'A2 开关关:输入栏新建笔记无任何自动标签',
  cleared1 === true && n1 !== null && n1.tags.length === 1 && n1.tags[0] === MARK,
  `输入栏已清空=${cleared1} tags=${JSON.stringify(n1?.tags)} created_at=${n1?.created_at}`
);

// —— A3 开关开:新建笔记自动带 时间排序/YYYY/MM/DD ——
const settingsOpen2 = await a.openSettings();
await a.clickSel(SEL_SWITCH);
const onDb = await waitFor(() => a.getSetting('auto_time_tag').then((v) => (v === 'true' ? v : null)), 20, 200);
await a.resetUi();
const cleared2 = await a.saveNote(`#${MARK} step3 自动标签开`);
const n2 = await a.findNote('step3 自动标签开');
const want2 = datePath(TPL_DEFAULT, n2?.created_at);
r.record(
  'A3 开关开:输入栏新建笔记自动带 时间排序/YYYY/MM/DD',
  onDb === 'true' && settingsOpen2 === true && cleared2 === true && n2 !== null && n2.tags.includes(want2) && n2.tags.includes(MARK),
  `设置分区已渲染=${settingsOpen2} 库值=${onDb} tags=${JSON.stringify(n2?.tags)} 期望=${want2}`
);

// —— A4/A5 模板换根名 -> 自动标签落新根;改回默认 ——
const settingsOpen3 = await a.openSettings();
await a.setValue(main, SEL_TPL, TPL_ALT);
const tpl1 = await waitFor(() => a.getSetting('time_tag_template').then((v) => (v === TPL_ALT ? v : null)), 25, 250);
await a.resetUi();
const cleared3 = await a.saveNote(`#${MARK} step3 自定义模板`);
const n3 = await a.findNote('step3 自定义模板');
const want3 = datePath(TPL_ALT, n3?.created_at);
r.record(
  'A4 time_tag_template 改成 日期/{y}/{m}/{d} 后自动标签落新根',
  tpl1 === TPL_ALT && settingsOpen3 === true && cleared3 === true && n3 !== null && n3.tags.includes(want3),
  `设置分区已渲染=${settingsOpen3} 库值=${tpl1} tags=${JSON.stringify(n3?.tags)} 期望=${want3}`
);
const settingsOpen4 = await a.openSettings();
const tplBefore = await a.getSetting('time_tag_template');
await a.setValue(main, SEL_TPL, TPL_DEFAULT);
const tpl2 = await waitFor(() => a.getSetting('time_tag_template').then((v) => (v === TPL_DEFAULT ? v : null)), 25, 250);
await a.resetUi();
r.record('A5 模板从 日期/... 改回默认并落库', settingsOpen4 === true && tplBefore === TPL_ALT && tpl2 === TPL_DEFAULT, `改前库值=${tplBefore} 改后库值=${tpl2}`);

// —— A6-A8 排序:只剩两个方向 + 切换后按 id 反向 + DOM 跟随 ——
await sleep(500);
if ((await a.sortLabel())?.includes('最早')) {
  await a.clickSort();
  await sleep(700);
}
const newest = { label: await a.sortLabel(), ids: await a.idsHead('newest'), back: await a.backHead('newest'), dom: await a.domHead() };
await a.clickSort();
await sleep(700);
const oldest = { label: await a.sortLabel(), ids: await a.idsHead('oldest'), back: await a.backHead('oldest'), dom: await a.domHead() };
const twoWay = /排序: (最新|最早)/;
r.record('A6 排序只有两个方向(最新/最早)', twoWay.test(newest.label) && twoWay.test(oldest.label) && newest.label !== oldest.label, `${newest.label} -> ${oldest.label}`);
r.record(
  'A7 切换后顺序按 id 反向变化(前后各 3 条)',
  newest.ids[0] > newest.ids[1] && newest.ids[1] > newest.ids[2] &&
    oldest.ids[0] < oldest.ids[1] && oldest.ids[1] < oldest.ids[2] && newest.ids[0] > oldest.ids[0],
  `最新=${JSON.stringify(newest.ids)} 最早=${JSON.stringify(oldest.ids)}`
);
r.record(
  'A8 笔记流 DOM 顺序跟随后端(前 3 条正文对照)',
  JSON.stringify(newest.dom) === JSON.stringify(newest.back) && JSON.stringify(oldest.dom) === JSON.stringify(oldest.back),
  `最新 DOM=${JSON.stringify(newest.dom)} 后端=${JSON.stringify(newest.back)} | 最早 DOM=${JSON.stringify(oldest.dom)} 后端=${JSON.stringify(oldest.back)}`
);

// —— E1 导出 xlsx(临时路径;日期列对照由 scripts/lifelog-xlsx-check.py 做)——
await a.call('export_notes', { path: EXPORT_PATH });
const exportBytes = statSync(EXPORT_PATH).size;
r.record('E1 导出 xlsx 到临时目录(临时文件不入库)', exportBytes > 20000, `路径=${EXPORT_PATH} 字节=${exportBytes}`);

// —— A9/A10 改名行为:模板仍指旧根时改根名会另建同名根 ——
const beforeList = await a.tagList();
const rootNode = beforeList.find((t) => t.path === '时间排序');
const renamedRootId = rootNode.id;
const nodeCount = subtree(beforeList, '时间排序').length;
const noteCount = rootNode.subtree_count;
await a.call('rename_tag', { tagId: renamedRootId, newName: '时间线' });
const afterRename = await a.tagList();
const renamedNode = afterRename.find((t) => t.path === '时间线');
r.record(
  'A9 时间排序 可改名(时间线):节点数与标签下笔记数都不变(时间标签=普通标签)',
  !afterRename.some((t) => t.path === '时间排序' || t.path.startsWith('时间排序/')) &&
    subtree(afterRename, '时间线').length === nodeCount &&
    renamedNode?.subtree_count === noteCount,
  `改名前节点=${nodeCount}(含 A3 自动标签新建的 时间排序/2026/09/17)改名后=${subtree(afterRename, '时间线').length} 笔记数=${noteCount}->${renamedNode?.subtree_count}`
);
const cleared4 = await a.saveNote(`#${MARK} step3 模板旧根`);
const n4 = await a.findNote('step3 模板旧根');
const after4 = await a.tagList();
const fresh = subtree(after4, '时间排序');
const oldIds = new Set(afterRename.map((t) => t.id));
r.record(
  'A10 模板仍指旧根时改根名 -> 新建笔记另建同名根(D5 可配置行为,实测记录)',
  cleared4 === true && n4 !== null && n4.tags.some((t) => t.startsWith('时间排序/')) &&
    fresh.length === 4 && fresh.every((t) => !oldIds.has(t.id)) &&
    fresh.map((t) => t.path).join('|') === `时间排序|时间排序/2026|时间排序/2026/09|时间排序/${today}` &&
    subtree(after4, '时间线').length === nodeCount,
  `新根节点=${fresh.length}[${fresh.map((t) => t.path).join(', ')}] 全是新 id=${fresh.every((t) => !oldIds.has(t.id))} tags=${JSON.stringify(n4?.tags)} 时间线仍=${subtree(after4, '时间线').length}`
);

const evidence = {
  baseHits,
  baseTags: { total: baseTags.length, timeSubtree: tRoot.length, dayLevel },
  baselinePaths: baseTags.map((t) => t.path),
  // 安全闸用:基线全部标签 id(清理脚本只允许删"不在这个集合里"的节点)
  baselineIds: baseTags.map((t) => t.id),
  // A10 新建的 时间排序 根及其子节点 id(清理脚本只能按这些 id 删)
  newRootIds: fresh.map((t) => t.id),
  filterLastBefore,
  testNotes: { 自动标签关: n1?.id, 自动标签开: n2?.id, 自定义模板: n3?.id, 模板旧根: n4?.id },
  exportPath: EXPORT_PATH,
  exportBytes,
  renamedRootId,
  results: r.results,
};
writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2));
console.log('证据文件:', EVIDENCE);
console.log('测试笔记 id:', JSON.stringify(evidence.testNotes), '被改名根 id:', renamedRootId);
r.finish();
closeMain();
closeInput();
