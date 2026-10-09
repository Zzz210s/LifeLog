#!/usr/bin/env node
/**
 * T4.4 端到端验收(统一实体 / 统一元数据迁移后的核心面)。
 * 读数:
 *   ① user_version=29 + 对账七条全 PASS
 *   ② 默认筛选命中 1373(IPC query_notes 与库侧口径逐值一致)
 *   ③ 树闭包 742(list_tags == path IS NOT NULL)
 *   ④ `#X`/`[[X]]` 目标域:自建笔记→笔记引用夹具,验 `[[X]]` 落成 link 边且图里可见
 *   ⑤ 导出跟随当前筛选(sheet「条目」/ 四列表头 / 行数 == 筛选命中)
 *   ⑥ 关系图载荷与耗时(graph_data 读数 2:≤80ms 且 ≤200KB)
 *   ⑦ 夹具零残留(计数 / 版本 / integrity / note_links / 筛选命中逐项回基线)
 * 前置:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" pnpm tauri dev
 * 跑法:LIFELOG_CDP_PORT=9222 node scripts/entity-migration/e2e.mjs
 * 真库验收只读走 db-compat.mjs 的 TEMP 兼容视图;夹具一律 `E2E测试` 前缀,自建自删。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CDP_PORT, conditions, ensureMain, recorder } from '../cdp-lib.mjs';
import { openReadOnly, DB_PATH } from '../db-compat.mjs';
import { ipc } from '../carry-accept-lib.mjs';
import { readGraphData } from '../graph-accept-g1-reads.mjs';
import { runReconcile } from './reconcile-lib.mjs';

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

const ro = (fn) => {
  const db = openReadOnly(DB_PATH);
  try { return fn(db); } finally { db.close(); }
};
const n = (sql, ...a) => ro((db) => db.prepare(sql).get(...a).n);
const all = (sql, ...a) => ro((db) => db.prepare(sql).all(...a).map((r) => ({ ...r })));
const counts = () =>
  ro((db) => {
    const c = (sql) => db.prepare(sql).get().n;
    return {
      entities: c('SELECT COUNT(*) n FROM entities'),
      tags: c('SELECT COUNT(*) n FROM tags'),
      notes: c('SELECT COUNT(*) n FROM notes'),
      link: c('SELECT COUNT(*) n FROM note_links'),
      version: db.prepare('PRAGMA user_version').get().user_version,
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    };
  });
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

// ---------- ① 迁移版本 + 对账七条 ----------
const sqlPath = fileURLToPath(new URL('./reconcile.sql', import.meta.url));
const rec = runReconcile({ dbPath: DB_PATH, sqlPath });
record(
  '① user_version=29 且对账全 PASS(0 FAIL / 0 N/A)',
  rec.user_version === 29 && rec.summary.fail === 0 && rec.summary.na === 0,
  `user_version=${rec.user_version} PASS ${rec.summary.pass} / FAIL ${rec.summary.fail} / N/A ${rec.summary.na}`,
);

// ---------- ② 默认筛选命中:IPC 与库侧逐值一致 ----------
const base = counts();
const cond0 = await streamCond();
const hits0 = await pageAll(cond0);
const dbHits0 = n('SELECT COUNT(*) n FROM entities WHERE path IS NULL OR instr(meta, char(10)) > 0');
record(
  '② 默认筛选命中 1373(IPC query_notes == 库侧 treeMembership=out OR singleLine=multi)',
  hits0.length === 1373 && dbHits0 === 1373 && hits0.length === dbHits0,
  `IPC=${hits0.length} 库侧=${dbHits0}`,
);

// ---------- ③ 树闭包 742 ----------
const tagRows = await ipc(cdp, 'list_tags');
const dbTree = n('SELECT COUNT(*) n FROM entities WHERE path IS NOT NULL');
record(
  '③ 树闭包 742(list_tags == path IS NOT NULL)',
  tagRows.length === 742 && dbTree === 742 && tagRows.length === dbTree,
  `list_tags=${tagRows.length} 库侧=${dbTree}`,
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

  // ---------- ⑤ 导出跟随当前筛选 ----------
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
    '⑤ 导出 xlsx 跟随当前筛选(sheet「条目」/ 四列表头 / 行数 == 筛选命中)',
    x.count === hitsNow && JSON.stringify(x.sheets) === JSON.stringify(['条目']) &&
      JSON.stringify(x.header) === JSON.stringify(['id', '正文', '创建时间', '引用路径']),
    `导出=${x.count} 筛选命中=${hitsNow}(基线 ${hits0.length} + 夹具 2) sheet=${JSON.stringify(x.sheets)} 表头=${JSON.stringify(x.header)}`,
  );
} finally {
  for (const id of fixtureNotes) await ipc(cdp, 'delete_note', { id }).catch(() => null);
  for (const t of (await ipc(cdp, 'list_tags').catch(() => [])).filter((t) => t.path.startsWith(NS))) {
    await ipc(cdp, 'delete_tag', { tagId: t.id }).catch(() => null);
  }
  if (existsSync(XLSX)) unlinkSync(XLSX);
}

// ---------- ⑥ 关系图载荷与耗时(读数 2) ----------
await ipc(cdp, 'graph_data'); // 预热:首调含 SQLite 页缓存冷启,读数 2 是热态单次采样(与图视图内跑同口径)
await readGraphData({ cdp, record });

// ---------- ⑦ 夹具零残留(前后同读数) ----------
const after = counts();
const leftovers = all('SELECT id FROM entities WHERE path LIKE ?1 OR meta LIKE ?2', `${NS}%`, `%${NS}%`);
const remainingLinks = all('SELECT id FROM note_links');
const hitsAfter = (await pageAll(cond0)).length;
record(
  '⑦ 夹具零残留:计数/版本/integrity/筛选命中回基线,无 E2E测试 实体,note_links 归零',
  JSON.stringify(after) === JSON.stringify(base) && leftovers.length === 0 &&
    remainingLinks.length === 0 && hitsAfter === hits0.length,
  `基线=${JSON.stringify(base)} 收尾=${JSON.stringify(after)} 残留实体=${leftovers.length} note_links=${remainingLinks.length} ` +
    `筛选命中 ${hitsAfter}/${hits0.length}`,
);

finish();
close();
process.exit(process.exitCode ?? 0);
