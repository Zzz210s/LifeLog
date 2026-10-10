#!/usr/bin/env node
/** 对账 CLI：只读跑 reconcile.sql，打印十条读数与 PASS/FAIL。
 *  用法: node scripts/entity-migration/reconcile.mjs [--db <path>] [--sql <path>] [--json]
 *  默认真库只读；绝不写库（mode=ro）。 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBlocks, runReconcile, formatReport, failed } from './reconcile-lib.mjs';

const DEFAULT_DB = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
const DEFAULT_SQL = fileURLToPath(new URL('./reconcile.sql', import.meta.url));

function parseArgs(argv) {
  const o = { db: DEFAULT_DB, sql: DEFAULT_SQL, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--db') o.db = argv[++i];
    else if (a === '--sql') o.sql = argv[++i];
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`未知参数: ${a}（--db / --sql / --json）`);
  }
  return o;
}

const USAGE = `用法: node scripts/entity-migration/reconcile.mjs [--db <path>] [--sql <path>] [--json]
  --db    待对账的库（默认真库，只读打开）
  --sql   reconcile.sql 路径（默认同目录，可用变异副本做自证）
  --json  输出结构化 JSON
说明: 十条对账见 reconcile.sql；0 行 = PASS；v30 旧库整组 N/A；库不可写、不产生副作用。`;

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}
// 先确认 SQL 文件可解析（顺带把语法错误挡在 python 之前）
const blocks = parseBlocks(readFileSync(opts.sql, 'utf8'));
if (blocks.length === 0) {
  console.error(`reconcile.sql 未解析出任何语句块: ${opts.sql}`);
  process.exit(2);
}
const report = runReconcile({ dbPath: opts.db, sqlPath: opts.sql });
if (opts.json) console.log(JSON.stringify(report, null, 2));
else console.log(formatReport(report));
process.exit(failed(report) ? 1 : 0);
