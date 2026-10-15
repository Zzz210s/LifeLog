#!/usr/bin/env node
/**
 * 关系语法 T6 收口验证器:设计 §8 的 A1-A12 现场读数(真库一律只读,写面只在副本)。
 *   node scripts/relation-syntax-verify.mjs [--live <真库>] [--copy <副本>] [--tag <快照标记>]
 *        [--json]
 * 副本缺省时用 `entity-migration/snapshot.mjs`(VACUUM INTO)现制;副本上的写面由 Rust 步骤用例
 * `notes_relation_syntax_accept_tests`(ignored)逐步执行,每步之间本脚本用只读 SQL 取读数,
 * 于是 A5-A7 的判据拿到的是真实的状态迁移;A7 收尾会把夹具删净,副本回到基线。
 * 退出码:0 全 PASS / 1 有 FAIL / 2 参数或前置不满足。
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  LIVE_DB, SNAP_DIR, compareFts, compareIds, judgeBareParen, judgeClearName, judgeDelete,
  judgeMetaNameGroup, judgeRename, judgeRoundtrip, makeCopy, openRO, readRelJson, readings,
  runCargoTest,
} from './relation-syntax-verify-lib.mjs';

const SCAN = fileURLToPath(new URL('./relation-name-scan.mjs', import.meta.url));

function parseArgs(argv) {
  const o = { live: LIVE_DB, copy: null, tag: 'relsyntax', json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--live') o.live = argv[++i];
    else if (a === '--copy') o.copy = argv[++i];
    else if (a === '--tag') o.tag = argv[++i];
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`未知参数: ${a}`);
  }
  return o;
}

const USAGE = `用法: node scripts/relation-syntax-verify.mjs [--live <真库>] [--copy <副本>] [--tag <标记>] [--json]
  --live  真库(默认装机库;只读打开,一个字节都不写)
  --copy  VACUUM INTO 副本(默认在 ${SNAP_DIR} 下现制;同名标记的近期副本会复用)
  --json  末尾附结构化读数(@@RELVERIFY@@ 行)`;

const rows = [];
const check = (id, title, ok, detail) => {
  rows.push({ id, title, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${title} | ${detail}`);
};
const scan = (db) => {
  const r = spawnSync(process.execPath, [SCAN, '--db', db], { encoding: 'utf8' });
  const text = r.stdout.trim().split('\n');
  return JSON.parse(text.slice(text.indexOf('{')).join('\n'));
};
const rawLine = (out, needle) => (out.split('\n').find((l) => l.includes(needle)) ?? '').trim();

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}
const copy = opts.copy ?? makeCopy({ live: opts.live, tag: opts.tag });
console.log(`== 关系语法收口对账 A1-A12 ==\n真库(只读): ${opts.live}\n副本(写面): ${copy}\n`);
const HL = openRO(opts.live);
const H = openRO(copy);
const rLive = readings(HL);
const rCopy0 = readings(H);
console.log(`基线: 真库 ${JSON.stringify(rLive.counts)} fts ${rLive.fts.rows} 行 / ${rLive.fts.sha.slice(0, 16)}…`);
console.log(`副本 ${JSON.stringify(rCopy0.counts)} fts ${rCopy0.fts.rows} 行 / ${rCopy0.fts.sha.slice(0, 16)}…`);
check('基线', '副本是真库的忠实副本', compareFts(rLive, rCopy0).ok && rLive.named.length === rCopy0.named.length,
  `名线各 ${rLive.named.length} 条;FTS ${compareFts(rLive, rCopy0).ok ? '逐字节相同' : '不同'}`);

// ---- Rust 只读读数(第一把尺子;命中集走生产 query 路径) ----
const readRust = () => readRelJson(runCargoTest('relation_syntax_readings', {
  LIFELOG_REL_LIVE: opts.live, LIFELOG_REL_COPY: copy,
}).out);
const RB = readRust();
check('基线b', '副本与真库的命中集逐值相同', Object.keys(RB.live.hits).every((k) =>
  compareIds(k, RB.live.hits[k], RB.copy.hits[k]).ok),
  Object.entries(RB.live.hits).map(([k, v]) => `${k}=${v.length}`).join(' / '));

// ---- A8 新建可表达(副本上真实保存漏斗:源码 #目标(名字)) ----
const step = (name, env = {}) => {
  const r = runCargoTest('relation_syntax_copy_step', { LIFELOG_REL_COPY: copy, LIFELOG_REL_STEP: name, ...env });
  if (r.code !== 0) {
    console.log(r.out.split('\n').slice(-25).join('\n'));
    throw new Error(`Rust 步骤 ${name} 退出码 ${r.code}`);
  }
  return readRelJson(r.out);
};
const a8 = step('a8');
const target = a8.target;
const guo = Number(H.prepare("SELECT id FROM points WHERE path IS NULL AND meta = '国籍'").get().id);
const r8 = readings(H, { from: a8.note, to: target });
check('A8', '新建可表达(#新目标(国籍) 自动落名线)', a8.line.name_id === guo && a8.line.id > 0,
  `笔记 ${a8.note} -> 目标 ${target} 的线 ${a8.line.id},name_id=${a8.line.name_id}(既有「国籍」点 ${guo},未新建点)`);
check('A9', '名字不进正文', judgeMetaNameGroup(r8).ok && !a8.meta.includes('(国籍)'),
  `真库残留 ${rLive.metaNameGroups.length} 条;保存后的正文 meta=${JSON.stringify(a8.meta)}`);
check('A10', '名字不进 FTS', a8.name_point_fts === 0 && a8.paths_named === a8.paths_plain && r8.namePointFts === 0,
  `名字点 fts 行 ${a8.name_point_fts};名线来源 paths 与无名线来源 paths 逐字节相同(${a8.paths_named.length} 字符,前 40: ${JSON.stringify(a8.paths_named.slice(0, 40))}…)`);

// ---- A5 清名字 / A6 改名 / A7 删除(每步前后各取一次只读读数) ----
const pair = () => readings(H, { from: a8.note, to: target });
const NOTE = { LIFELOG_REL_NOTE: String(a8.note) };
const b5 = pair();
step('a5', NOTE);
const j5 = judgeClearName(b5, pair());
check('A5', '清名字可表达(#目标)', j5.ok,
  `线 ${j5.lineBefore?.id} name_id ${j5.lineBefore?.nameId} -> ${JSON.stringify(j5.lineAfter?.nameId)}(线 id 不变)`);
const b6 = pair();
step('a6', NOTE);
const j6 = judgeRename(b6, pair());
check('A6', '改名可表达(#目标(新名))', j6.ok,
  `线 ${j6.lineBefore?.id} -> ${j6.lineAfter?.id}(不变),name_id -> ${j6.lineAfter?.nameId}`);
const b7 = pair();
step('a7', { ...NOTE, LIFELOG_REL_CONTROL: String(a8.control) });
const j7 = judgeDelete(b7, pair());
const rCopy7 = readings(H);
const jiguanLeft = Number(H.prepare("SELECT COUNT(*) c FROM points WHERE path IS NULL AND meta = '籍贯'").get().c);
check('A7', '删除可表达(源码不再写该目标)', j7.ok && jiguanLeft === 0,
  `线消失=${j7.lineAfter === null};遗留「籍贯」名字点 ${jiguanLeft} 个;其它目标的名线保持 ${j7.keptOthers} 条`);

// ---- A4 53 条名线往返无损(真库副本上的真实写线语义) ----
const b4 = readings(H);
const rt = runCargoTest('roundtrip_named_lines_keeps_ids_and_names', { LIFELOG_SNAPSHOT_DB: copy });
const j4 = judgeRoundtrip(b4, readings(H));
check('A4', '名线往返无损', rt.code === 0 && j4.ok,
  `${rawLine(rt.out, '副本往返无损') || `cargo 退出码 ${rt.code}`};往返前后各 ${j4.named} 条${j4.diff.length ? ` 差异 ${j4.diff.join('; ')}` : ',逐条相同'}`);

// ---- A1/A2 名字写入前后:命中集与 FTS 必须回到基线 ----
const RA = readRust();
const rCopy1 = readings(H);
const [a1, a2] = [Object.keys(RA.live.hits).every((k) => compareIds(k, RA.live.hits[k], RA.copy.hits[k]).ok),
  compareFts(rLive, rCopy1)];
check('A1', '命中集逐值+顺序不变', a1,
  Object.entries(RA.live.hits).map(([k, v]) => `${k} ${v.length}==${RA.copy.hits[k].length}`).join(' / '));
check('A2', 'points_fts sha256 不变', a2.ok && RB.live.fts_sha === RA.live.fts_sha,
  `${rLive.fts.rows} 行 / ${rLive.fts.sha.slice(0, 16)}…;副本收尾 ${rCopy1.fts.rows} 行 / ${rCopy1.fts.sha.slice(0, 16)}…;收尾计数 ${JSON.stringify(rCopy7.counts)} == 基线 ${JSON.stringify(rCopy0.counts)}`);

// ---- A12 存量裸括号(两把尺子:本脚本判据 + 既有扫描脚本) ----
const sLive = scan(opts.live);
const sCopy = scan(copy);
const j12 = judgeBareParen(rLive);
check('A12', '裸括号禁令(存量 0 违规)', j12.ok && sLive.ok && sCopy.ok && sLive.paren_paths === 2 && j12.parenPaths.length === 2,
  `真库树内违规 ${j12.tree.length} / 含括号 path ${j12.parenPaths.length}(${j12.parenPaths.map((p) => p.path).join('、')}) / 非法名字 ${sLive.invalid_relation_names.length};副本违规 ${sCopy.bare_paren_tree_metas.length}`);

// ---- A3 导出列 + A11 表达式守卫 ----
const ex = runCargoTest('export_real_db_readout', { LIFELOG_EXPORT_DB: opts.live });
check('A3', '导出列不变', ex.code === 0 && rawLine(ex.out, '真库导出读数').length > 0,
  rawLine(ex.out, '真库导出读数').replace(/^.*真库导出读数:/, '真库导出读数:'));
const a11 = runCargoTest('truth_table_row_38_expression_read_tag_ignores_name_group', {}, ['--nocapture']);
const a11ok = a11.code === 0 && /test result: ok\. 1 passed/.test(a11.out);
check('A11', '表达式零变化(#a/b(名) 只吃 a/b)', a11ok,
  `cargo 退出码 ${a11.code};${(a11.out.match(/test result: ok\. \d+ passed/) ?? ['未匹配'])[0]}`);

HL.close();
H.close();
if (opts.json) console.log(`\n@@RELVERIFY@@${JSON.stringify({ live: opts.live, copy, readings: rows, rust: { before: RB, after: RA }, a8, scan: { live: sLive, copy: sCopy } })}`);
const fails = rows.filter((r) => !r.ok).length;
console.log(`\n== A1-A12: PASS ${rows.length - fails} / FAIL ${fails} ==`);
process.exit(fails ? 1 : 0);
