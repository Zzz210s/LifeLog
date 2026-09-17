// 时间标签降级验收的清理与复位:删净测试笔记/测试标签,清掉测试新增的标签节点,
// 还原根名与设置,并断言标签路径集合/计数逐项回到基线。
// 用法(dev + 9222 仍在跑):node scripts/dev-cdp-accept-timetag-clean.mjs
import { readFileSync } from 'node:fs';
import { open, sleep, recorder } from './cdp-lib.mjs';
import { MARK, TPL_DEFAULT, EVIDENCE, actions, subtree, dayNodes } from './timetag-lib.mjs';

const FILTER_LAST_BASELINE = '{"keyword":null,"tags":[],"excludeTags":[],"tagPresence":null,"sort":"newest","expr":null}';
const MARK_COND = { keyword: MARK, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null };
const r = recorder();
const { cdp: main, close: closeMain } = await open('main');
const a = actions(main, null);
const evidence = JSON.parse(readFileSync(EVIDENCE, 'utf8'));
const baseline = new Set(evidence.baselinePaths);

// 1 删净测试笔记(按关键词盘点,逐个 delete_note;标签链由后端事务清理)
const before = await a.call('query_notes', { conditions: MARK_COND, offset: 0 });
for (const n of before) await a.call('delete_note', { id: n.id });
const after = await a.call('query_notes', { conditions: MARK_COND, offset: 0 });
r.record(`C1 测试笔记删净(删除 ${before.length} 条)`, after.length === 0, `删除前=${JSON.stringify(before.map((n) => n.id))} 删除后剩=${after.length}`);

// 2 删测试造出的整根(基线无「日期」;「时间排序」根此刻是 A10 另建的新根)
let list = await a.tagList();
for (const root of ['日期', '时间排序']) {
  const node = list.find((t) => t.path === root);
  if (node) {
    await a.call('delete_tag', { tagId: node.id });
    list = await a.tagList();
  }
}

// 3 逐个清掉「基线没有」的多余节点(A3 自动标签新建的今天日级节点等):
//   把基线路径按 时间排序 -> 时间线 映射后做差集,由深到浅删空壳(删前已清空其链接)
const nowPaths = () => list.filter((t) => t.path === '时间线' || t.path.startsWith('时间线/'));
const expected = new Set([...baseline].map((p) => (p === '时间排序' || p.startsWith('时间排序/') ? '时间线' + p.slice('时间排序'.length) : p)));
let extra = [];
for (let round = 0; round < 5; round++) {
  extra = list.filter((t) => !expected.has(t.path));
  if (extra.length === 0) break;
  for (const t of [...extra].sort((x, y) => y.depth - x.depth)) await a.call('delete_tag', { tagId: t.id });
  await sleep(200);
  list = await a.tagList();
}
r.record(
  'C2 测试标签清净(日期 与 A10 另建根 + 测试新增节点)',
  extra.length === 0 &&
    !list.some((t) => t.path.startsWith('日期/') || t.path === '日期') &&
    !list.some((t) => t.path === '时间排序' || t.path.startsWith('时间排序/')) &&
    list.some((t) => t.path === '时间线'),
  `多余节点=${extra.map((t) => t.path).join(',') || '无'} 时间线根仍在=${list.some((t) => t.path === '时间线')}(节点 ${nowPaths().length})`
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

// 5 复位设置(开关/模板/筛选排序)
await a.call('set_setting', { key: 'auto_time_tag', value: 'true' });
await a.call('set_setting', { key: 'time_tag_template', value: TPL_DEFAULT });
await a.call('set_setting', { key: 'filter_last', value: FILTER_LAST_BASELINE });
const [auto, tpl, filter] = await Promise.all([a.getSetting('auto_time_tag'), a.getSetting('time_tag_template'), a.getSetting('filter_last')]);
r.record(
  'C4 设置复位(auto_time_tag/time_tag_template/filter_last)',
  auto === 'true' && tpl === TPL_DEFAULT && filter === FILTER_LAST_BASELINE,
  `开关=${auto} 模板=${tpl} filter_last=${filter}`
);

// 6 集合级还原证明:路径集合逐个相同 + 计数 + 命中回到基线
const nowSet = new Set(list.map((t) => t.path));
const diff = [...baseline].filter((p) => !nowSet.has(p)).concat([...nowSet].filter((p) => !baseline.has(p)));
r.record(
  'C5 标签路径集合与基线逐项相同(570 个,无新增无缺失)',
  diff.length === 0 && list.length === 570 && list.reduce((s, t) => s + t.id, 0) === 167866,
  `集合差异=${diff.join(',') || '无'} 标签数=${list.length} id和=${list.reduce((s, t) => s + t.id, 0)}`
);
const hits = Object.fromEntries(await a.call('count_view_hits'));
r.record(
  'C6 内置视图计数回到基线(all=1357 todo=286 untagged=0)',
  hits.all === 1357 && hits.todo === 286 && hits.untagged === 0,
  `all=${hits.all} todo=${hits.todo} untagged=${hits.untagged}`
);
console.log('被 A9 改名的根 id:', evidence.renamedRootId, '导出文件(临时目录,不入库):', evidence.exportPath);
r.finish();
closeMain();
