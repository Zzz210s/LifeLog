// 时间标签降级验收的清理与复位:删净测试笔记/测试标签,清掉测试新增的标签节点,
// 还原根名与设置,并断言标签路径集合/计数逐项回到基线。
// 用法(dev + 9222 仍在跑):node scripts/dev-cdp-accept-timetag-clean.mjs
import { readFileSync } from 'node:fs';
import { ensureMain, sleep, recorder } from './cdp-lib.mjs';
import { MARK, TPL_DEFAULT, EVIDENCE, actions, subtree, dayNodes } from './timetag-lib.mjs';

const FILTER_LAST_BASELINE = '{"keyword":null,"tags":[],"excludeTags":[],"tagPresence":null,"sort":"newest","expr":null}';
const MARK_COND = { keyword: MARK, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null };
const r = recorder();
const { cdp: main, close: closeMain } = await ensureMain();
const a = actions(main, null);
const evidence = JSON.parse(readFileSync(EVIDENCE, 'utf8'));
const baseline = new Set(evidence.baselinePaths);
// 安全闸:只允许删“不在基线 id 集合里”的节点。缺了证据就**拒绝删任何标签** ——
// 曾经的风险:第二步无条件按路径删「时间排序」,若验收里的改名(A9)未跑成,
// 「时间排序」就是真实的 312 节点树,一步就会解链 1031 条笔记并重写 FTS。
const baselineIds = new Set(evidence.baselineIds ?? []);
const newRootIds = new Set(evidence.newRootIds ?? []);
if (baselineIds.size === 0 || newRootIds.size === 0) {
  console.error('拒绝执行:证据文件缺少 baselineIds/newRootIds(旧版验收产物)。' +
    '请重跑 dev-cdp-accept-timetag.mjs 生成新证据,或手工核对后再清。');
  process.exit(2);
}
const deletable = (t) => !baselineIds.has(t.id) && newRootIds.has(t.id);
// 前置断言:真实树必须已经改名成 时间线(否则说明 A9 没跑成,此刻 时间排序 仍是真树)
const preList = await a.tagList();
const preTime = subtree(preList, '时间排序');
const preLine = subtree(preList, '时间线');
const preOk = preTime.every((t) => newRootIds.has(t.id)) && preLine.length === subtree(preList, '时间线').length && preLine.length >= 300;
if (!preOk) {
  console.error(`拒绝删标签:时间排序 子树 ${preTime.length} 节点中存在基线节点` +
    `(新根 id 命中=${preTime.filter((t) => newRootIds.has(t.id)).length})、时间线子树=${preLine.length}。` +
    '这可能是改名步骤未执行,手工核对后再跑。');
  process.exit(3);
}

// 1 删净测试笔记(按关键词盘点,逐个 delete_note;标签链由后端事务清理)
const before = await a.call('query_notes', { conditions: MARK_COND, offset: 0 });
for (const n of before) await a.call('delete_note', { id: n.id });
const after = await a.call('query_notes', { conditions: MARK_COND, offset: 0 });
r.record(`C1 测试笔记删净(删除 ${before.length} 条)`, after.length === 0, `删除前=${JSON.stringify(before.map((n) => n.id))} 删除后剩=${after.length}`);

// 2 只删验收自己造出的那几个新根节点(按 id 白名单,绝不按路径删) ——
//   A10 另建的「时间排序」根 + 其 3 个子节点
let list = await a.tagList();
const toDrop = list.filter(deletable).sort((x, y) => y.depth - x.depth);
for (const t of toDrop) await a.call('delete_tag', { tagId: t.id });
list = await a.tagList();

// 3 逐个清掉「基线没有」的多余节点(A3 自动标签新建的今天日级节点、A5 自定义模板新建的 日期/… 等):
//   把基线路径按 时间排序 -> 时间线 映射后做差集,**且必须 id 不在基线集合里**才允许删
const nowPaths = () => list.filter((t) => t.path === '时间线' || t.path.startsWith('时间线/'));
const expected = new Set([...baseline].map((p) => (p === '时间排序' || p.startsWith('时间排序/') ? '时间线' + p.slice('时间排序'.length) : p)));
let extra = [];
let refused = [];
for (let round = 0; round < 5; round++) {
  extra = list.filter((t) => !expected.has(t.path));
  if (extra.length === 0) break;
  for (const t of [...extra].sort((x, y) => y.depth - x.depth)) {
    // 双重保险:哪怕路径对不上,只要 id 在基线里就绝不删
    if (baselineIds.has(t.id)) {
      refused.push(t.path);
      continue;
    }
    await a.call('delete_tag', { tagId: t.id });
  }
  await sleep(200);
  list = await a.tagList();
}
r.record(
  'C2 测试标签清净(日期 与 A10 另建根 + 测试新增节点)',
  extra.length === 0 && refused.length === 0 &&
    !list.some((t) => t.path.startsWith('日期/') || t.path === '日期') &&
    !list.some((t) => t.path === '时间排序' || t.path.startsWith('时间排序/')) &&
    list.some((t) => t.path === '时间线'),
  `按 id 删=${toDrop.map((t) => t.path).join(',') || '无'} 多余节点=${extra.map((t) => t.path).join(',') || '无'} ` +
    `拒绝删(命中基线 id)=${refused.join(',') || '无'} 时间线根仍在=${list.some((t) => t.path === '时间线')}(节点 ${nowPaths().length})`
);

// 4 还原根名:时间线 -> 时间排序
const renamed = list.find((t) => t.path === '时间线');
await a.call('rename_tag', { tagId: renamed.id, newName: '时间排序' });
list = await a.tagList();
r.record(
  'C3 根名还原为 时间排序(节点 312 / 日级 275 与基线一致)',
  subtree(list, '时间排序').length === 312 && dayNodes(list, '时间排序').length === 275,
  `改名根 id=${renamed.id} 节点=${subtree(list, '时间排序').length} 日级=${dayNodes(list, '时间排序').length}`
);

// 5 复位设置(开关/模板/筛选排序):filter_last 按**验收前读到的原值**还原
const filterLastBack = evidence.filterLastBefore ?? FILTER_LAST_BASELINE;
await a.call('set_setting', { key: 'auto_time_tag', value: 'true' });
await a.call('set_setting', { key: 'time_tag_template', value: TPL_DEFAULT });
await a.call('set_setting', { key: 'filter_last', value: filterLastBack });
const [auto, tpl, filter] = await Promise.all([a.getSetting('auto_time_tag'), a.getSetting('time_tag_template'), a.getSetting('filter_last')]);
r.record(
  'C4 设置复位(auto_time_tag/time_tag_template/filter_last 还原为验收前值)',
  auto === 'true' && tpl === TPL_DEFAULT && filter === filterLastBack,
  `开关=${auto} 模板=${tpl} filter_last=${filter}(还原目标=${filterLastBack})`
);

// 6 集合级还原证明:路径集合逐个相同 + id 集合逐个相同 + 命中回到基线
const nowSet = new Set(list.map((t) => t.path));
const nowIds = new Set(list.map((t) => t.id));
const diff = [...baseline].filter((p) => !nowSet.has(p)).concat([...nowSet].filter((p) => !baseline.has(p)));
const idDiff = [...baselineIds].filter((i) => !nowIds.has(i)).concat([...nowIds].filter((i) => !baselineIds.has(i)));
r.record(
  'C5 标签路径与 id 集合都与基线逐项相同(无新增无缺失)',
  diff.length === 0 && idDiff.length === 0,
  `路径差异=${diff.join(',') || '无'} id 差异=${idDiff.join(',') || '无'} 标签数=${list.length}`
);
const hits = Object.fromEntries(await a.call('count_view_hits'));
const wantHits = evidence.baseHits ?? { all: 1357, todo: 286, untagged: 0 };
r.record(
  'C6 内置视图计数回到基线(按证据里的基线值对照)',
  Object.entries(wantHits).every(([k, v]) => hits[k] === v),
  `now=${JSON.stringify(hits)} baseline=${JSON.stringify(wantHits)}`
);
console.log('被 A9 改名的根 id:', evidence.renamedRootId, '导出文件(临时目录,不入库):', evidence.exportPath);
r.finish();
closeMain();
