#!/usr/bin/env node
/** T1.5 阶段 1 收口编排（计划 Task 1.5 / spec §10.2、§10.3、§10.6）。
 *  流程: 基线快照 -> 副本跑 031 -> 十条对账 -> 三条等价性 -> 老库升级链 -> 空库重放 -> 反例自检。
 *  迁移只在副本上跑（走 `cargo test --ignored migrate_snapshot_copy` + LIFELOG_COPY_DB 指向副本），
 *  真库一个字节都不写。反例自检在副本的副本上删一个闭包点，断言等价性必须报 FAIL。
 *  用法: node scripts/entity-migration/verify-031.mjs [--self-check] [--v31 <已迁副本>] [--keep] */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { runReconcile, formatReport } from './reconcile-lib.mjs';
import {
  openRO, userVersion, compareTreeClosure, compareFeedDefault, compareFtsPaths, formatEq, CLOSURE_V31,
} from './verify-031-lib.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SNAP = 'F:/0-code/_lifelog-snapshots';
const SQL = fileURLToPath(new URL('./reconcile.sql', import.meta.url));
const DEFAULTS = {
  base: `${SNAP}/lifelog.db.bak-p31-pre-20261010T162007Z`, // v30 真库原样快照
  work: `${SNAP}/verify-031-work.db`,
  old: `${SNAP}/lifelog.db.bak-p05-20261009T050517Z`, // 历史 v27 快照（<28 升级链）
  v31: null, selfCheck: false, keep: false, help: false,
};

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base') o.base = argv[++i];
    else if (a === '--work') o.work = argv[++i];
    else if (a === '--old') o.old = argv[++i];
    else if (a === '--v31') o.v31 = argv[++i];
    else if (a === '--self-check') o.selfCheck = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`未知参数: ${a}`);
  }
  return o;
}

const USAGE = `用法: node scripts/entity-migration/verify-031.mjs [--base <v30快照>] [--work <副本>] [--old <老快照>]
       [--v31 <已迁副本>] [--self-check] [--keep]
  --v31  复用已迁好的 v31 副本做只读等价性（跳过 cargo 迁移）
  --self-check  在副本的副本上删一个闭包点，断言树闭包等价性必须 FAIL（反例自检）`;

const results = [];
const check = (label, ok, detail) => {
  results.push({ label, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` :: ${detail}` : ''}`);
};
const readVersion = (p) => { const db = openRO(p); const v = userVersion(db); db.close(); return v; };
const rm = (p) => { if (existsSync(p)) rmSync(p, { force: true }); };
const count = (db, sql) => db.prepare(sql).get().n;

/** 在副本上跑 031（真库不写）。返回 cargo 读数。 */
function migrate(path) {
  const r = spawnSync('cargo', ['test', '--lib', '--', '--ignored', 'migrate_snapshot_copy'], {
    cwd: join(ROOT, 'src-tauri'), encoding: 'utf8', env: { ...process.env, LIFELOG_COPY_DB: path },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const passed = /(\d+) passed/.exec(out);
  return { ok: r.status === 0 && /test result: ok/.test(out), tail: (passed ? `passed=${passed[1]}` : out.trim().split('\n').slice(-2).join(' / ')) };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(USAGE); process.exit(0); }
  if (!existsSync(opts.base)) { console.error(`基线快照不存在: ${opts.base}`); process.exit(2); }

  check('基线副本是 v30', readVersion(opts.base) === 30, `${opts.base} user_version=${readVersion(opts.base)}`);

  let work = opts.v31;
  if (!work) {
    rm(opts.work);
    copyFileSync(opts.base, opts.work);
    console.log(`> 副本迁移: 复制快照 -> ${opts.work} 后跑 031`);
    const m = migrate(opts.work);
    check('副本 031 迁移（cargo --ignored migrate_snapshot_copy）', m.ok, m.tail);
    work = opts.work;
  } else {
    console.log(`> 复用 v31 副本（未跑迁移）: ${work}`);
  }
  check('副本 user_version=31', readVersion(work) === 31, `user_version=${readVersion(work)}`);

  const ro30 = openRO(opts.base);
  const ro31 = openRO(work);
  console.log('\n> 十条对账（副本）');
  const rec = runReconcile({ dbPath: work, sqlPath: SQL });
  console.log(formatReport(rec));
  check('副本对账全 PASS（十二条含 integrity / fk）', rec.summary.fail === 0 && rec.summary.na === 0,
    `PASS ${rec.summary.pass} / FAIL ${rec.summary.fail} / N/A ${rec.summary.na}`);

  console.log('\n> 三条等价性（v30 基线 对 v31 副本）');
  const tree = compareTreeClosure(ro30, ro31);
  const feed = compareFeedDefault(ro30, ro31);
  const fts = compareFtsPaths(ro30, ro31);
  for (const e of [tree, feed, fts]) check(`等价性: ${e.label}`, e.ok, formatEq(e));

  if (opts.selfCheck) {
    const mut = `${work}.mut`;
    rm(mut);
    copyFileSync(work, mut);
    const db = new DatabaseSync(mut);
    // 副本的 FTS 触发器会调 Rust 注册的标量函数 tag_plain / entity_name / entity_key；
    // node:sqlite 里必须自己挂上（口径无关紧要：反例只读闭包，不读 FTS）。
    db.function('tag_plain', (s) => (s == null ? '' : String(s)));
    db.function('entity_name', (s) => (s == null ? '' : String(s).split(/\r?\n/).map((x) => x.trim()).find(Boolean) ?? ''));
    db.function('entity_key', (s) => String(s ?? '').replace(/#[^\s#]+/g, '').trim().toLowerCase());
    // 选一个「在闭包内、但不 is_cited」的父点（闭包多出的那批祖先，真库 88 个）；删掉它全部
    // 出子级线（它是这些孩子的父），它就不再是任何闭包成员的祖先 -> 闭包必然少点。
    const victim = db.prepare(`WITH RECURSIVE c(id) AS (SELECT id FROM points WHERE is_cited = 1
        UNION SELECT x.from_id FROM lines x JOIN c ON c.id = x.to_id WHERE x.name_id = 0)
      SELECT p.id FROM points p WHERE p.is_cited = 0 AND p.id IN (SELECT id FROM c)
        AND EXISTS(SELECT 1 FROM lines l WHERE l.name_id = 0 AND l.from_id = p.id) LIMIT 1`).get();
    if (!victim) { check('反例自检: 找到可删的闭包点', false, '闭包内没有带子级线的非 is_cited 父点'); }
    else {
      const before = db.prepare(CLOSURE_V31).all().length;
      db.prepare('DELETE FROM lines WHERE name_id = 0 AND from_id = ?').run(victim.id);
      const after = db.prepare(CLOSURE_V31).all().length;
      const mutRO = openRO(mut);
      const mutEq = compareTreeClosure(ro30, mutRO);
      check('反例自检: 删一个闭包点后树闭包等价性必须 FAIL', !mutEq.ok && after < before,
        `删点=${victim.id} 闭包 ${before} -> ${after} | ${formatEq(mutEq)}`);
      mutRO.close();
    }
    db.close();
    if (!opts.keep) rm(mut);
  }
  ro30.close();
  ro31.close();
}

function oldAndEmpty(opts) {
  if (opts.old && existsSync(opts.old)) {
    const oldWork = `${opts.old}.v31work`;
    rm(oldWork);
    const from = readVersion(opts.old);
    copyFileSync(opts.old, oldWork);
    console.log(`\n> 老库升级链: v${from} -> v31（${opts.old}）`);
    const m = migrate(oldWork);
    const rec = runReconcile({ dbPath: oldWork, sqlPath: SQL });
    check(`老库升级 v${from} -> v31`, m.ok && readVersion(oldWork) === 31 && rec.summary.fail === 0,
      `v${from}->v31 对账 PASS ${rec.summary.pass}/FAIL ${rec.summary.fail} points=${rec.counts.points} lines=${rec.counts.lines} pure_name=${rec.counts.pure_name_points}`);
    if (!opts.keep) rm(oldWork);
  }
  const empty = `${SNAP}/verify-031-empty.db`;
  rm(empty);
  new DatabaseSync(empty).close();
  console.log(`\n> 空库重放 001..031 + 重复迁移幂等（${empty}）`);
  const m1 = migrate(empty);
  const v1 = readVersion(empty);
  const m2 = migrate(empty);
  const v2 = readVersion(empty);
  const db = openRO(empty);
  const reserved = count(db, "SELECT COUNT(*) n FROM points WHERE id = 0 AND meta = '子级'");
  db.close();
  const rec = runReconcile({ dbPath: empty, sqlPath: SQL });
  check('空库重放与幂等', m1.ok && m2.ok && v1 === 31 && v2 === 31 && reserved === 1 && rec.summary.fail === 0,
    `v1=${v1} v2=${v2} 保留点=${reserved} 对账 PASS ${rec.summary.pass}/FAIL ${rec.summary.fail} points=${rec.counts.points}`);
  if (!opts.keep) rm(empty);
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) { console.log(USAGE); process.exit(0); }
main();
oldAndEmpty(opts);
const fails = results.filter((r) => !r.ok).length;
console.log(`\n== T1.5 阶段 1 收口: PASS ${results.length - fails} / FAIL ${fails} ==`);
process.exit(fails ? 1 : 0);
