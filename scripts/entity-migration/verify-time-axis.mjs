#!/usr/bin/env node
/** 时间轴收敛 T3/T5 收口编排：快照 -> 副本 dry-run -> apply -> E1–E6 / S2 六项 -> integrity/fk。
 *  编排模式（会跑 cargo 写副本，真库零写入）:
 *    node scripts/entity-migration/verify-time-axis.mjs --phase tree|created-at|both \
 *         --base <收敛前快照> [--work <工作副本>] [--keep] [--self-check]
 *  只读比对模式（不跑 cargo）:
 *    node scripts/entity-migration/verify-time-axis.mjs --phase tree|created-at \
 *         --before <库> --after <库> [--self-check]
 *  退出码: 0 全 PASS / 1 有 FAIL / 2 参数或前置不满足。 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAxis, compareTree, compareCreatedAt } from './time-axis-lib.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RECONCILE = fileURLToPath(new URL('./reconcile.mjs', import.meta.url));
const PHASES = ['tree', 'created-at', 'both'];
const USAGE = `用法: node scripts/entity-migration/verify-time-axis.mjs --phase tree|created-at|both
       (--base <收敛前快照> [--work <工作副本>] [--keep] | --before <库> --after <库>) [--self-check]`;

function parseArgs(argv) {
  const o = { phase: null, base: null, work: null, before: null, after: null, keep: false, selfCheck: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--phase') o.phase = argv[++i];
    else if (a === '--base') o.base = argv[++i];
    else if (a === '--work') o.work = argv[++i];
    else if (a === '--before') o.before = argv[++i];
    else if (a === '--after') o.after = argv[++i];
    else if (a === '--keep') o.keep = true;
    else if (a === '--self-check') o.selfCheck = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`未知参数: ${a}(--phase/--base/--work/--before/--after/--keep/--self-check)`);
  }
  return o;
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` :: ${detail}` : ''}`);
};

function reportTree(before, after) {
  const t = compareTree(before, after);
  check('E1 笔记标签集合按 时间/日期->时间 映射全等', t.e1diff.length === 0, `差异 ${t.e1diff.length} 篇`);
  check('E2 计数逐项可解释', t.e2bad.length === 0 && t.mergeOk && t.leftover === 0,
    `删 ${t.del} 个容器 id=${JSON.stringify(t.gone)} / 合并 ${t.merges} 次 / merge_log +${t.mergeDelta}`);
  check('E3 笔记 id 集合不变', t.e3ok);
  check('E4 信息流默认筛选与首页 id 集合不变', t.feedOk, `${before.readings.feed} -> ${after.readings.feed}`);
  check(`E5 时间簇节点与树边各 -${t.del}`, t.delta.time_nodes === -t.del && t.delta.time_edges === -t.del,
    `节点 ${before.readings.time_nodes}->${after.readings.time_nodes} / 边 ${before.readings.time_edges}->${after.readings.time_edges}`);
  check('E6 设置三键无 时间/日期 残留且其余逐字节不变', t.e6.length === 0, `差异 ${t.e6.length}`);
  return t;
}

function reportCreatedAt(before, after) {
  const c = compareCreatedAt(before, after);
  check('① 有日标签笔记 created_at 日期 == 日标签 且时分秒 00:00:00',
    c.hits === c.aligned && c.bad === 0, `命中 ${c.hits} / 对齐 ${c.aligned} / 非法 ${c.bad}(${c.daysBefore}->${c.daysAfter})`);
  check('② 无日标签笔记 (id, created_at) 逐字节不变', c.untouchedDiff.length === 0,
    `比对 ${c.untouched} 篇 / 差异 ${c.untouchedDiff.length} 行`);
  check('③ 只动 created_at 一列（读数 + 行级签名）', c.readDiff.length === 0 && c.sigDiff.length === 0,
    `差异键 ${[...c.readDiff, ...c.sigDiff].join(',') || '无'}`);
  console.log(`INFO ④ 日标签一日多篇 ${c.collisions.length} 组 / ${c.collisionNotes} 篇（现场重算）`);
  const top = c.collisions.slice(0, 5).map(([d, n]) => `${d}=${n}`).join(', ');
  console.log(`INFO ⑥ 改后按日分布 top5: ${top}；同日并列 ${c.collisions.length} 组，最大组 ${c.collisions[0] ? `${c.collisions[0][0]} = ${c.collisions[0][1]} 篇` : '-'}`);
  return c;
}

function runCargo(phase, db, apply) {
  const args = ['run', '--quiet', '--features', 'tools', '--bin', 'time-axis-ops', '--', '--db', db, '--phase', phase];
  if (apply) args.push('--apply');
  const r = spawnSync('cargo', args, { cwd: join(ROOT, 'src-tauri'), encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { ok: r.status === 0, status: r.status, out };
}

function runReconcile(db) {
  const r = spawnSync('node', [RECONCILE, '--db', db], { encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

/** 反例自检（纯 JS 改快照，不写库）：E1 必须能报 FAIL、① 必须能报 FAIL。 */
function selfCheck(phase, before, after, treeAfter) {
  if (phase !== 'created-at') {
    const mut = structuredClone(before);
    const id = Object.keys(mut.note_tags)[0];
    mut.note_tags[id] = [...(mut.note_tags[id] || []), '时间/日期/9999/99/99'];
    const t = compareTree(mut, after);
    check('反例自检: 改一条标签后 E1 必须 FAIL', !t.ok && t.e1diff.length > 0, `E1 差异 ${t.e1diff.length}`);
  }
  if (phase !== 'tree') {
    const base = phase === 'both' ? treeAfter : before;
    const mut = structuredClone(after);
    const id = Object.keys(mut.days)[0];
    mut.notes[id] = `${mut.days[id]} 12:34:56`;
    const c = compareCreatedAt(base, mut);
    check('反例自检: 时分秒未归零时 ① 必须 FAIL', !c.ok && c.aligned < c.hits, `对齐 ${c.aligned}/${c.hits}`);
  }
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(USAGE); return 0; }
  if (!PHASES.includes(o.phase)) { console.error(`--phase 必须是 ${PHASES.join('|')}\n${USAGE}`); return 2; }

  if (o.before || o.after) { // 只读比对模式
    if (o.phase === 'both') { console.error('只读模式不支持 both；both 请用 --base 编排模式'); return 2; }
    if (!o.before || !o.after || !existsSync(o.before) || !existsSync(o.after)) { console.error('需要 --before 与 --after 且文件存在'); return 2; }
    const before = readAxis(o.before);
    const after = readAxis(o.after);
    if (o.phase === 'tree') reportTree(before, after); else reportCreatedAt(before, after);
    check('integrity ok', after.integrity === 'ok', after.integrity);
    check('foreign_key_check 0 行', after.fk === 0, `${after.fk} 行`);
    if (o.selfCheck) selfCheck(o.phase, before, after, null);
    return results.every(Boolean) ? 0 : 1;
  }

  if (!o.base || !existsSync(o.base)) { console.error(`需要 --base 且文件存在\n${USAGE}`); return 2; }
  const work = o.work || `${o.base}.verify-${o.phase}.db`;
  const rm = (p) => { if (existsSync(p)) rmSync(p, { force: true }); };
  rm(work);
  copyFileSync(o.base, work);
  console.log(`> 副本: ${o.base} -> ${work}`);
  const before = readAxis(o.base);

  const dry = runCargo(o.phase, work, false);
  console.log(`> dry-run(${o.phase}):\n${dry.out}`);
  if (!dry.ok) { console.error('dry-run 失败'); return 2; }

  let treeAfter = null;
  if (o.phase === 'both') {
    const tw = `${work}.tree`;
    rm(tw); copyFileSync(o.base, tw);
    const rt = runCargo('tree', tw, true);
    console.log(`> tree --apply(串跑基线):\n${rt.out}`);
    if (!rt.ok) { console.error('tree --apply 失败'); return 2; }
    treeAfter = readAxis(tw);
    if (!o.keep) rm(tw);
  }
  const applied = runCargo(o.phase, work, true);
  console.log(`> ${o.phase} --apply:\n${applied.out}`);
  if (!applied.ok) { console.error('apply 失败'); return 2; }
  const after = readAxis(work);

  if (o.phase === 'tree') reportTree(before, after);
  else if (o.phase === 'created-at') reportCreatedAt(before, after);
  else { reportTree(before, treeAfter); reportTree(before, after); reportCreatedAt(treeAfter, after); }

  check('integrity ok', after.integrity === 'ok', after.integrity);
  check('foreign_key_check 0 行', after.fk === 0, `${after.fk} 行`);
  const rec = runReconcile(work);
  console.log(rec.out);
  check('十条对账 PASS / FAIL 0 / N/A 0', rec.ok && /FAIL 0/.test(rec.out) && /N\/A 0/.test(rec.out), '见上');
  if (o.selfCheck) selfCheck(o.phase, before, after, treeAfter);
  if (!o.keep) rm(work);

  const fails = results.filter((x) => !x).length;
  console.log(`\n== verify-time-axis(${o.phase}): PASS ${results.length - fails} / FAIL ${fails} ==`);
  return fails ? 1 : 0;
}

process.exit(main());
