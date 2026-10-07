#!/usr/bin/env node
/** T2.3 阶段 2 对账 CLI：在 v25 真库副本上跑 spec §3 五条对账（reconcile.sql）+ ④ 两条
 *  「老链接表 <-> `edges`」双向 EXCEPT 等价，读数落 JSON。只读打开（python `mode=ro`），绝不写库。
 *  用法: node scripts/entity-migration/phase2-reconcile.mjs [--db <path>] [--out <json>]
 *  Rust 侧逐值用例见 src-tauri/src/db/entities_phase2_tests.rs。 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runReconcile, formatReport } from './reconcile-lib.mjs';

const DEFAULT_DB = 'F:/0-code/_lifelog-snapshots/lifelog.db.bak-p02-20261007T125755Z';
const DEFAULT_SQL = fileURLToPath(new URL('./reconcile.sql', import.meta.url));
const DEFAULT_OUT = 'F:/0-code/_lifelog-snapshots/phase2-reconcile.json';
const OFFSET = 1000000000;

/** 两条对账的四个方向：老 `tag_links` -> `edges`（fwd）与反向（bwd）；`remark` 一并比对。 */
const CHECKS = {
  tagging_fwd: `SELECT target_id, tag_id + ${OFFSET} FROM tag_links WHERE target_type='note'
    EXCEPT SELECT source_id, target_id FROM edges WHERE kind='tagging'`,
  tagging_bwd: `SELECT target_id - ${OFFSET}, source_id FROM edges WHERE kind='tagging'
    EXCEPT SELECT tag_id, target_id FROM tag_links WHERE target_type='note'`,
  relation_fwd: `SELECT tag_id + ${OFFSET}, target_id + ${OFFSET}, remark FROM tag_links
    WHERE target_type IN ('tag','type')
    EXCEPT SELECT source_id, target_id, remark FROM edges WHERE kind='relation'`,
  relation_bwd: `SELECT source_id - ${OFFSET}, target_id - ${OFFSET}, remark FROM edges
    WHERE kind='relation'
    EXCEPT SELECT tag_id, target_id, remark FROM tag_links WHERE target_type IN ('tag','type')`,
};

const PY = `import json,sqlite3,sys
db=sys.argv[1].replace(chr(92),'/')
checks=json.load(sys.stdin)
c=sqlite3.connect('file:'+db+'?mode=ro',uri=True)
out={}
for k,s in checks.items():
    try:
        out[k]=[list(r) for r in c.execute(s).fetchall()]
    except Exception as e:
        out[k]={'error':str(e)}
print(json.dumps(out,ensure_ascii=False))`;

function parseArgs(argv) {
  const o = { db: DEFAULT_DB, out: DEFAULT_OUT, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--db') o.db = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`未知参数: ${a}（--db / --out）`);
  }
  return o;
}

const USAGE = `用法: node scripts/entity-migration/phase2-reconcile.mjs [--db <path>] [--out <json>]
  --db   待对账的 v25 库（默认 T2 阶段的真库副本，只读打开）
  --out  读数 JSON 输出路径（默认 F:/0-code/_lifelog-snapshots/phase2-reconcile.json）
说明: 五条缓存对账见 reconcile.sql；两条 EXCEPT 是「老链接表 <-> edges」双向等价；0 行 = PASS。`;

/** 只读跑四个 EXCEPT 方向，返回 { key: rows | {error} }。 */
function runChecks(dbPath) {
  const raw = execFileSync('python', ['-c', PY, dbPath], {
    input: JSON.stringify(CHECKS),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  return JSON.parse(raw);
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}

const report = runReconcile({ dbPath: opts.db, sqlPath: DEFAULT_SQL });
const raw = runChecks(opts.db);
const exceptChecks = Object.entries(raw).map(([key, rows]) => {
  if (!Array.isArray(rows)) return { key, status: 'ERR', rowCount: null, error: rows.error };
  return { key, status: rows.length === 0 ? 'PASS' : 'FAIL', rowCount: rows.length, rows: rows.slice(0, 5) };
});
const summary = {
  reconcile: report.summary,
  except: {
    pass: exceptChecks.filter((c) => c.status === 'PASS').length,
    fail: exceptChecks.filter((c) => c.status !== 'PASS').length,
  },
};
const out = {
  db: opts.db,
  user_version: report.user_version,
  counts: report.counts,
  checks: report.checks,
  exceptChecks,
  summary,
};
writeFileSync(opts.out, JSON.stringify(out, null, 2), 'utf8');

console.log(formatReport(report));
console.log('');
console.log(`== 两条 EXCEPT 等价（标签 id 偏移 ${OFFSET}）==`);
for (const c of exceptChecks) console.log(`  ${c.key} ${c.status} (${c.rowCount} 行)`);
console.log('');
console.log(`写出读数: ${opts.out}`);
process.exit(summary.reconcile.fail > 0 || summary.except.fail > 0 ? 1 : 0);
