#!/usr/bin/env node
/** 时间轴收敛只读读数（计划 T3）。
 *  用法: node scripts/entity-migration/time-axis-readout.mjs --db <库> [--after <库>]
 *  只读打开（mode=ro）；打印 S1/S2 关键读数、日标签对齐情况、默认模板与库内设置比对。
 *  给 --after 时打印前后差值与 S1/S2 比对摘要。退出码:0 全 PASS / 1 有 FAIL / 2 参数错。 */
import { existsSync } from 'node:fs';
import { readAxis, compareTree, compareCreatedAt } from './time-axis-lib.mjs';

/** 默认模板真源（`src-tauri/src/timetag.rs::DEFAULT_TEMPLATE`，三处真源之一）。 */
export const DEFAULT_TEMPLATE = '时间/{y}/{m}/{d}';

function parseArgs(argv) {
  const o = { db: null, after: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') o.db = argv[++i];
    else if (argv[i] === '--after') o.after = argv[++i];
    else throw new Error(`未知参数: ${argv[i]}(--db / --after)`);
  }
  return o;
}

const ROWS = [
  ['points', '点总数'], ['lines', '线总数'], ['fts', 'points_fts 行数'],
  ['tree', '树内点(path 非空)'], ['closure', '树闭包'], ['cited', 'is_cited=1'],
  ['feed', '信息流默认筛选'], ['merge_log', 'entity_merge_log'],
  ['time_nodes', '时间簇节点'], ['time_edges', '时间簇树边'],
  ['date_layer', '时间/日期 节点'],
];

function printReadings(label, snap) {
  console.log(`[读数] ${label} (${snap.db})`);
  for (const [k, name] of ROWS) console.log(`  ${k.padEnd(12)} ${String(snap.readings[k]).padStart(6)}  ${name}`);
  console.log(`  日标签笔记 ${Object.keys(snap.days).length} 篇 / 无日标签 ${Object.keys(snap.notes).length - Object.keys(snap.days).length} 篇`);
  console.log(`  integrity=${snap.integrity} foreign_key_check=${snap.fk} 行`);
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.db || !existsSync(o.db)) {
    console.error('需要 --db 且文件存在');
    return 2;
  }
  const fails = [];
  const check = (ok, label, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' ' + detail : ''}`);
    if (!ok) fails.push(label);
  };
  const before = readAxis(o.db);
  printReadings('收敛前', before);
  const tpl = before.settings.time_tag_template;
  check(tpl === DEFAULT_TEMPLATE, '默认模板 == 库内 time_tag_template',
    `库内=${JSON.stringify(tpl)} 代码默认=${JSON.stringify(DEFAULT_TEMPLATE)}`);
  if (o.after) {
    if (!existsSync(o.after)) { console.error(`--after 不存在: ${o.after}`); return 2; }
    const after = readAxis(o.after);
    printReadings('收敛后', after);
    const t = compareTree(before, after);
    console.log(`[S1] 删除容器 ${t.del} 个 id=${JSON.stringify(t.gone)} / 同名合并 ${t.merges} 次`);
    console.log(`[S1] 计数差值 ${JSON.stringify(t.delta)} / merge_log +${t.mergeDelta}`);
    check(t.ok, 'S1 收敛等价性（E1–E6）',
      `E1 差异 ${t.e1diff.length} 篇 / E2 异常键 ${JSON.stringify(t.e2bad)} / 残留 ${t.leftover}`);
    const c = compareCreatedAt(before, after);
    console.log(`[S2] 命中 ${c.hits} 篇（对齐 ${c.aligned} 篇）/ 解析失败 ${c.bad} 篇 / 无日标签 ${c.untouched} 篇（差异 ${c.untouchedDiff.length} 行）`);
    console.log(`[S2] 一日多篇 ${c.collisions.length} 组 / ${c.collisionNotes} 篇；top3 ${JSON.stringify(c.collisions.slice(0, 3))}`);
    check(c.hits === c.aligned && c.bad === 0 && c.untouchedDiff.length === 0,
      'S2 对齐与无日标签不动', `命中 ${c.hits} / 对齐 ${c.aligned} / 差异 ${c.untouchedDiff.length}`);
  }
  return fails.length ? 1 : 0;
}

process.exit(main());
