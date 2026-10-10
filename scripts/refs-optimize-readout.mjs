#!/usr/bin/env node
/**
 * 引用优化 A + C 的只读读数器(配 refs-optimize-ops.mjs 用):对任一库打印 JSON 读数,
 * 用于 before/after 对照。只读打开(约定只喂副本)。
 *
 * 口径与产品代码同源:
 *  - 筛选/关键词谓词见 `scripts/refs-predicate-lib.mjs`(照 `filter_predicates.rs` +
 *    `notes_filter_groups_compile.rs`,含 `note_only` 收窄);
 *  - 侧栏计数见 `scripts/refs-sidebar-lib.mjs`(照 `db/repos/tags/query.rs::counts`);
 *  - 关系图载荷见 `scripts/refs-graph-lib.mjs`(照 `db/repos/graph.rs` + `commands/graph.rs`)。
 * 用法: node scripts/refs-optimize-readout.mjs --db <路径> [--out <json 路径>]
 */
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildPredicates } from './refs-predicate-lib.mjs';
import { sidebarCounts } from './refs-sidebar-lib.mjs';
import { graphReadout } from './refs-graph-lib.mjs';

const argv = process.argv.slice(2);
const opt = { db: '', out: '' };
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--db') opt.db = argv[++i];
  else if (argv[i] === '--out') opt.out = argv[++i];
  else throw new Error(`未知参数: ${argv[i]}`);
}
if (!opt.db) {
  console.error('用法: node scripts/refs-optimize-readout.mjs --db <路径> [--out <json 路径>]');
  process.exit(2);
}
const db = new DatabaseSync(opt.db, { readOnly: true });
const all = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const n1 = (sql) => one(`SELECT COUNT(*) c FROM ${sql}`).c;
const { runWhere, ids } = buildPredicates(db);

const classes = {
  note_tag: n1("edges e JOIN entities s ON s.id=e.source_id JOIN entities t ON t.id=e.target_id WHERE e.kind='link' AND s.path IS NULL AND t.path IS NOT NULL"),
  note_note: n1("edges e JOIN entities s ON s.id=e.source_id JOIN entities t ON t.id=e.target_id WHERE e.kind='link' AND s.path IS NULL AND t.path IS NULL"),
  tag_tag: n1("edges e JOIN entities s ON s.id=e.source_id JOIN entities t ON t.id=e.target_id WHERE e.kind='link' AND s.path IS NOT NULL AND t.path IS NOT NULL"),
  tag_note: n1("edges e JOIN entities s ON s.id=e.source_id JOIN entities t ON t.id=e.target_id WHERE e.kind='link' AND s.path IS NOT NULL AND t.path IS NULL"),
};
// 任务点名 9 个 + 预演沿用的一批(逐条给命中数,便于前后对照)
const KEYWORDS = ['待办', '待办/银行', '电影', '电影/真人', '旅游/餐厅', '地点轴/所在', '状态/已完成', '北京市', '作者/金观涛',
  '银行', '真人', '时间/日期', '已完成', '知识', '科幻', '进度/12', '游戏/知识', '游戏/科幻', '杂志'];
const raw = one("SELECT value FROM settings WHERE key='filter_current'")?.value ?? '';
let current = {};
try { current = JSON.parse(raw) ?? {}; } catch { current = {}; }
const FILTERS = [
  ['默认筛选 filter_current', () => runWhere(current)],
  ['旧默认:在树外 OR 多行', () => runWhere({ groupOp: 'and', groups: [{ op: 'or', items: [{ kind: 'treeMembership', value: 'out' }, { kind: 'singleLine', value: 'multi' }] }] })],
  ['标签: 待办(含子级)', () => ids({ kind: 'tag', path: '待办', includeChildren: true })],
  ['标签: 待办(仅本级)', () => ids({ kind: 'tag', path: '待办', includeChildren: false })],
  ['标签: 待办/银行(含子级)', () => ids({ kind: 'tag', path: '待办/银行', includeChildren: true })],
  ['标签: 待办/银行(仅本级)', () => ids({ kind: 'tag', path: '待办/银行', includeChildren: false })],
  ['标签: 电影(含子级)', () => ids({ kind: 'tag', path: '电影', includeChildren: true })],
  ['标签: 电影/真人(仅本级)', () => ids({ kind: 'tag', path: '电影/真人', includeChildren: false })],
  ['标签: 地点轴/所在(含子级)', () => ids({ kind: 'tag', path: '地点轴/所在', includeChildren: true })],
  ['标签: 地点轴/所在(仅本级)', () => ids({ kind: 'tag', path: '地点轴/所在', includeChildren: false })],
  ['标签: 状态/已完成(含子级)', () => ids({ kind: 'tag', path: '状态/已完成', includeChildren: true })],
  ['标签: 状态/已完成(仅本级)', () => ids({ kind: 'tag', path: '状态/已完成', includeChildren: false })],
  ['标签: 旅游/餐厅(仅本级)', () => ids({ kind: 'tag', path: '旅游/餐厅', includeChildren: false })],
  ['标签: 知识(含子级)', () => ids({ kind: 'tag', path: '知识', includeChildren: true })],
  ['关系: 状态/已完成', () => ids({ kind: 'relation', path: '状态/已完成' })],
  ['关系: 地点/日本(国籍)', () => ids({ kind: 'relation', path: '地点/日本' })],
  ['关系: 地点/中国大陆(国籍)', () => ids({ kind: 'relation', path: '地点/中国大陆' })],
];
const allCounts = sidebarCounts(db);
const SIDEBAR = ['待办', '待办/银行', '地点轴/所在', '状态/已完成', '旅游/餐厅'].map((p) => {
  const row = allCounts.find((c) => c.path === p);
  return row ? { path: p, id: row.id, self: row.self_count, subtree: row.subtree_count } : { path: p, missing: true };
});
const out = {
  db: opt.db,
  counts: {
    entities: n1('entities'), tree: n1('entities WHERE path IS NOT NULL'), notes: n1('entities WHERE path IS NULL'),
    is_cited: n1('entities WHERE is_cited = 1'), fts_rows: n1('entities_fts'),
    aliases: n1('entity_aliases'), merge_log: n1('entity_merge_log'),
  },
  edges: {
    total: n1('edges'), child: n1("edges WHERE kind='child'"), link: n1("edges WHERE kind='link'"), ...classes,
    tag_relations: all(`SELECT s.path AS src, t.path AS tgt, e.remark AS remark FROM edges e
      JOIN entities s ON s.id=e.source_id JOIN entities t ON t.id=e.target_id
      WHERE e.kind='link' AND s.path IS NOT NULL AND t.path IS NOT NULL ORDER BY s.path, t.path`)
      .map((r) => `${r.src} --(${r.remark})--> ${r.tgt}`),
  },
  keywords: KEYWORDS.map((k) => {
    const list = ids({ kind: 'keyword', value: k });
    return { k, mode: [...k].length >= 3 ? 'fts' : 'like', hits: list.length, ids: list };
  }),
  filters: FILTERS.map(([label, fn]) => {
    const list = fn();
    return { label, hits: list.length, ids: list };
  }),
  sidebar: SIDEBAR,
  graph: graphReadout(db),
};
const text = JSON.stringify(out, null, 1);
if (opt.out) writeFileSync(opt.out, text);
else console.log(text);
