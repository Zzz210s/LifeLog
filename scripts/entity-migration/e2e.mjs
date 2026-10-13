#!/usr/bin/env node
/**
 * T4.4/T2.5 端到端验收(统一实体 / 点线迁移后的核心面,覆盖 v30 与 v31)。
 * 读数:① 迁移链 + 对账无 FAIL;② 信息流条数 == 默认筛选库侧编译结果;
 *   ③ 树闭包 path 重算;③b 树节点数 == 已迁 v31 副本递归闭包;④ `#X`/`[[X]]` 目标域与 link 边;
 *   ④b 写一条笔记后树添新标签、新笔记立即可按该标签筛到、当前筛选命中与现场编译一致(增量现场重算,不写死);⑤ 反例:去掉默认筛选后条数 == 非纯名字点数;
 *   ⑥ 导出跟随筛选;⑦ 关系图载荷与耗时;⑧ 夹具零残留。
 * 前/跑法:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333" pnpm tauri dev;
 *   LIFELOG_CDP_PORT=9333 node scripts/entity-migration/e2e.mjs(真库只读走 db-compat TEMP 视图)。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CDP_PORT, conditions, ensureMain, recorder } from '../cdp-lib.mjs';
import { openReadOnly, DB_PATH } from '../db-compat.mjs';
import { ipc } from '../carry-accept-lib.mjs';
import { readGraphData } from '../graph-accept-g1-reads.mjs';
import { runReconcile } from './reconcile-lib.mjs';
import { dbFilterHits, treeDeltaOf, v31CopyReadings, NOT_PURE_V31 } from './e2e-lib.mjs';

const NS = 'E2E测试';
const TAG = `${NS}根`;
const A = `${NS}甲`;
const B = `${NS}乙`;
const XLSX = `${process.cwd()}/.superpowers/tmp-arch/e2e-export.xlsx`;

if (!(await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.ok, () => false))) {
  console.log(`需要先起应用:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${CDP_PORT}" pnpm tauri dev`);
  process.exit(2);
}
const { cdp, close } = await ensureMain();
const { record, finish } = recorder();

const ro = (fn) => { const db = openReadOnly(DB_PATH); try { return fn(db); } finally { db.close(); } };
const n = (sql, ...a) => ro((db) => db.prepare(sql).get(...a).n);
const all = (sql, ...a) => ro((db) => db.prepare(sql).all(...a).map((r) => ({ ...r })));
const counts = () => ro((db) => { const c = (sql) => db.prepare(sql).get().n;
  return { entities: c('SELECT COUNT(*) n FROM entities'), tags: c('SELECT COUNT(*) n FROM tags'),
    notes: c('SELECT COUNT(*) n FROM notes'), link: c('SELECT COUNT(*) n FROM note_links'),
    version: db.prepare('PRAGMA user_version').get().user_version,
    integrity: db.prepare('PRAGMA integrity_check').get().integrity_check }; });
const pageAll = async (cond) => {
  const out = [];
  for (let off = 0; ; ) {
    const p = await ipc(cdp, 'query_notes', { conditions: cond, offset: off });
    out.push(...p);
    if (p.length < 50) return out;
    off += p.length;
  }
};
const streamCond = async () => {
  const raw = await ipc(cdp, 'get_setting', { key: 'filter_current' });
  return { ...(raw ? JSON.parse(raw) : conditions({})), sort: 'newest' };
};

// 库侧筛选编译与 v31 副本读数见 e2e-lib.mjs(守 200 行红线)。

// ---------- ① 迁移版本 + 对账 ----------
const sqlPath = fileURLToPath(new URL('./reconcile.sql', import.meta.url));
const rec = runReconcile({ dbPath: DB_PATH, sqlPath });
const v31 = n("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='points'") === 1;
// 迁移链关键版本:版本号单调递增,user_version >= v 即链上含 v;除版本号外再钉每个版本的结构落点
// (029 建 FTS 表 / 030 建 FTS 视图)—— v31 起旧名换成 `points_fts` / `points_fts_src`。
const CHAIN = v31
  ? [[29, 'table', 'points_fts'], [30, 'view', 'points_fts_src']]
  : [[29, 'table', 'entities_fts'], [30, 'view', 'entities_fts_src']];
const marks = CHAIN.map(([v, t, nm]) => [v, n(`SELECT COUNT(*) n FROM sqlite_master WHERE type='${t}' AND name='${nm}'`)]);
const chainOk = rec.user_version >= Math.max(...CHAIN.map(([v]) => v)) && marks.every(([, c]) => c === 1);
record(
  '① user_version>=29 且迁移链关键版本(29/30)落点齐备 + 对账无 FAIL(v30 基线十条 N/A;v31 起要求全 PASS)',
  rec.user_version >= 29 && chainOk && rec.summary.fail === 0 && (!v31 || rec.summary.na === 0),
  `user_version=${rec.user_version} 链=${JSON.stringify(marks)} 对账 PASS ${rec.summary.pass} / FAIL ${rec.summary.fail} / N/A ${rec.summary.na}`,
);

// ---------- ② 当前筛选命中:IPC 与库侧 SQL 逐值一致 ----------
const base = counts();
const cond0 = await streamCond();
const hits0 = await pageAll(cond0);
const dbHits0 = dbFilterHits(n, cond0, v31 ? NOT_PURE_V31 : '1=1');
record(
  '② 当前筛选命中:IPC query_notes == 库侧按当前 filter_current 编译出的 SQL 命中数',
  hits0.length === dbHits0,
  `IPC=${hits0.length} 库侧=${dbHits0} 条件=${JSON.stringify(cond0)}`,
);

// ---------- ③ 树闭包:IPC list_tags 与库侧现场重算(path IS NOT NULL)比,真库树规模变化不假红 ----------
const tagRows = await ipc(cdp, 'list_tags');
const dbTree = n('SELECT COUNT(*) n FROM entities WHERE path IS NOT NULL');
record(
  '③ 树闭包(list_tags == 库侧现场重算 path IS NOT NULL)',
  tagRows.length === dbTree,
  `list_tags=${tagRows.length} 库侧=${dbTree}`,
);

// ---------- ③b 与已迁 v31 副本的递归闭包逐值(变异 031 的 child 映射为 NULL 时本项必红) ----------
const COPY_DB = process.env.LIFELOG_E2E_COPY_DB ?? 'F:/0-code/_lifelog-snapshots/lifelog-v31-live-copy.db';
const copy = existsSync(COPY_DB) ? v31CopyReadings(COPY_DB) : null;
record(
  '③b e2e_tree_closure_matches_copy_reading:树节点数 == 已迁副本递归闭包',
  !!copy && tagRows.length === copy.closure && copy.closure === copy.pathNotNull,
  copy
    ? `list_tags=${tagRows.length} 副本闭包=${copy.closure} 副本 path 非空=${copy.pathNotNull} 副本=${COPY_DB}`
    : `副本不存在: ${COPY_DB}`,
);

// ---------- ⑤ 反例:去掉默认筛选(空条件)后信息流条数 == 非纯名字点数;用完恢复筛选原值 ----------
const rawFilter = await ipc(cdp, 'get_setting', { key: 'filter_current' });
await ipc(cdp, 'set_setting', { key: 'filter_current', value: JSON.stringify(conditions({})) });
const noFilterHits = (await pageAll(conditions({}))).length;
await ipc(cdp, 'set_setting', { key: 'filter_current', value: rawFilter ?? '' });
const restoredFilter = await ipc(cdp, 'get_setting', { key: 'filter_current' });
const nonPure = v31 ? v31CopyReadings(DB_PATH).nonPure : n('SELECT COUNT(*) n FROM entities');
record(
  '⑤ 反例:去掉默认筛选后信息流条数 == 非纯名字点数(基集排除生效),筛选已恢复原状',
  noFilterHits === nonPure && restoredFilter === rawFilter,
  `空筛选命中=${noFilterHits} 非纯名字点=${nonPure} 筛选恢复=${restoredFilter === rawFilter}`,
);

// ---------- ④ `#X`/`[[X]]` 目标域:自建夹具并验边 ----------
const fixtureNotes = [];
try {
  const a = await ipc(cdp, 'save_input_note', { content: `${A}\n#${TAG}` });
  fixtureNotes.push(a.id);
  const b = await ipc(cdp, 'save_input_note', { content: `${B}\n#${TAG}\n[[${A}]]` });
  fixtureNotes.push(b.id);
  const links = all('SELECT source_id,target_id FROM note_links WHERE source_id IN (?1,?2) OR target_id IN (?1,?2) ORDER BY id', a.id, b.id);
  const tagHits = (await ipc(cdp, 'complete_tags', { prefix: NS })).filter((t) => t.path === TAG);
  const titles = (await ipc(cdp, 'complete_notes', { prefix: NS })).map((t) => t.title);
  const g = await ipc(cdp, 'graph_data');
  const linkPairs = (g.edges ?? [])
    .filter((e) => e.kind === 'link')
    .map((e) => [e.a, e.b])
    .filter(([x, y]) => (x === b.id && y === a.id) || (x === a.id && y === b.id));
  record(
    '④ `#X` 命中树域 / `[[X]]` 命中全实体域,且落成一条笔记→笔记 link 边(图里可见)',
    links.length === 1 && links[0].source_id === b.id && links[0].target_id === a.id &&
      tagHits.length === 1 && titles.includes(A) && titles.includes(B) && linkPairs.length === 1,
    `夹具 id=甲${a.id}/乙${b.id};note_links=${JSON.stringify(links.map((r) => [r.source_id, r.target_id]))};` +
      `complete_tags(${NS})=${tagHits.length};complete_notes 含甲/乙=${titles.includes(A)}/${titles.includes(B)};` +
      `graph link 边=${JSON.stringify(linkPairs)}`,
  );

  // ---------- ④b `#X`/`[[Y]]` 后:树添新标签 / 新笔记进流 / 当前筛选命中 == 现场编译(增量不写死) ----------
  const td = treeDeltaOf(tagRows, await ipc(cdp, 'list_tags'));
  const hitsFixture = (await pageAll(cond0)).length;
  // 「新笔记进没进流」用夹具自己的标签现场筛:cond0 是用户当前的真实筛选(可能是「印度」这类词条),
  // 写死「+2 笔记 +2 标签点」是环境依赖的假红;基集排除纯名字点,新标签点本就不进流。
  const fixtureHits = (await pageAll(conditions({ tags: [{ path: TAG, includeChildren: true }] }))).length;
  const dbHits = dbFilterHits(n, cond0, v31 ? NOT_PURE_V31 : '1=1');
  record(
    '④b 输入 `#X`/`[[Y]]` 后:树添新标签、新笔记立刻可按该标签筛到、当前筛选命中 == 现场编译',
    td.added.includes(TAG) && td.delta >= 1 && fixtureHits === fixtureNotes.length && hitsFixture === dbHits,
    `树 +${td.delta} 新增=${JSON.stringify(td.added)} 按新标签筛=${fixtureHits}(夹具 ${fixtureNotes.length} 笔) 当前筛选 ${hits0.length}->${hitsFixture}(现场编译 ${dbHits0}->${dbHits})`,
  );

  // ---------- ⑥ 导出跟随当前筛选 ----------
  if (existsSync(XLSX)) unlinkSync(XLSX);
  await ipc(cdp, 'export_notes', { path: XLSX });
  const hitsNow = (await pageAll(await streamCond())).length;
  const py = spawnSync(
    'python',
    ['-c', `import json,openpyxl;wb=openpyxl.load_workbook(r'${XLSX}');ws=wb['条目'];rows=list(ws.iter_rows(values_only=True));` +
      `print(json.dumps({'count':len(rows)-1,'header':list(rows[0]),'sheets':wb.sheetnames},ensure_ascii=False))`],
    { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
  );
  const x = JSON.parse(py.stdout.trim());
  record(
    '⑥ 导出 xlsx 跟随当前筛选(sheet「条目」/ 四列表头 / 行数 == 筛选命中)',
    x.count === hitsNow && JSON.stringify(x.sheets) === JSON.stringify(['条目']) &&
      JSON.stringify(x.header) === JSON.stringify(['id', '正文', '创建时间', '引用路径']),
    `导出=${x.count} 筛选命中=${hitsNow}(基线 ${hits0.length} + 新增点) sheet=${JSON.stringify(x.sheets)} 表头=${JSON.stringify(x.header)}`,
  );
} finally {
  for (const id of fixtureNotes) await ipc(cdp, 'delete_note', { id }).catch(() => null);
  for (const t of (await ipc(cdp, 'list_tags').catch(() => [])).filter((t) => t.path.startsWith(NS))) {
    await ipc(cdp, 'delete_tag', { tagId: t.id }).catch(() => null);
  }
  if (existsSync(XLSX)) unlinkSync(XLSX);
}

// ---------- ⑦ 关系图载荷与耗时(读数 2) ----------
await ipc(cdp, 'graph_data'); // 预热:首调含 SQLite 页缓存冷启,读数 2 是热态单次采样(与图视图内跑同口径)
await readGraphData({ cdp, record });

// ---------- ⑧ 夹具零残留(前后同读数) ----------
const after = counts();
const leftovers = all('SELECT id FROM entities WHERE path LIKE ?1 OR meta LIKE ?2', `${NS}%`, `%${NS}%`);
const remainingLinks = all('SELECT id FROM note_links');
const hitsAfter = (await pageAll(cond0)).length;
record(
  '⑧ 夹具零残留:计数/版本/integrity/筛选命中回基线,无 E2E测试 实体,note_links 归零',
  JSON.stringify(after) === JSON.stringify(base) && leftovers.length === 0 &&
    remainingLinks.length === 0 && hitsAfter === hits0.length,
  `基线=${JSON.stringify(base)} 收尾=${JSON.stringify(after)} 残留实体=${leftovers.length} note_links=${remainingLinks.length} ` +
    `筛选命中 ${hitsAfter}/${hits0.length}`,
);

finish();
close();
process.exit(process.exitCode ?? 0);
