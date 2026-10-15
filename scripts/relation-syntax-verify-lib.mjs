/** 关系语法收口(T6)的验证件:设计 §8 A1-A12 的**判据** + 副本准备 + 只读读数。
 *  本文件不写真库:副本一律由 `scripts/entity-migration/snapshot.mjs`(`VACUUM INTO`)生成。
 *  判据吃的是 [`readings`] 的读数对象(全是只读 SQL),故最小夹具
 *  (`relation-syntax-verify.test.mjs`)与真库上跑的是同一份代码。
 *  只用到 points(id, meta, path) / lines(id, from_id, to_id, name_id) /
 *  points_fts(rowid, paths) 三张表。 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const LIVE_DB = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
export const SNAP_DIR = 'F:/0-code/_lifelog-snapshots';
const TAURI = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const SNAPSHOT = fileURLToPath(new URL('./entity-migration/snapshot.mjs', import.meta.url));

/** 只读打开(URI + readOnly);写面只允许对副本、且由 Rust 步骤用例做 */
export const openRO = (p) => new DatabaseSync('file:' + p, { readOnly: true });
const num = (v) => Number(v);
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const one = (db, sql) => num(db.prepare(sql).get().c);

/** 全部名线 `(线 id, 来源, 目标, 名字文本)`,按线 id —— A4/A5-A7 的比对对象 */
export const namedLines = (db) =>
  db
    .prepare(
      'SELECT l.id, l.from_id, l.to_id, nm.meta FROM lines l JOIN points nm ON nm.id = l.name_id' +
        ' WHERE l.name_id IS NOT NULL AND l.name_id <> 0 ORDER BY l.id')
    .all()
    .map((r) => ({ id: num(r.id), from: num(r.from_id), to: num(r.to_id), name: String(r.meta) }));

/** 某来源指向某目标的唯一一条线 `(线 id, 名字点)`;没有返回 null */
export function lineOf(db, from, to) {
  const r = db.prepare('SELECT id, name_id FROM lines WHERE from_id = ?1 AND to_id = ?2 LIMIT 1').get(from, to);
  return r ? { id: num(r.id), from, to, nameId: r.name_id == null ? null : num(r.name_id) } : null;
}

/** `points_fts`:`(行数, rowid|paths 拼接的 sha256)` —— A2/A10 的逐字节比对对象 */
export function ftsReading(db) {
  const rows = db.prepare('SELECT rowid, paths FROM points_fts ORDER BY rowid').all();
  return {
    rows: rows.length,
    sha: sha(rows.map((r) => `${num(r.rowid)}\u0001${r.paths}\n`).join('')),
  };
}

/** 名字点自身有没有 `points_fts` 行(应恒为 0) */
export const namePointFtsRows = (db) =>
  one(
    db,
    'SELECT COUNT(*) c FROM points_fts f WHERE EXISTS(SELECT 1 FROM points p WHERE p.id = f.rowid' +
      ' AND p.path IS NULL AND EXISTS(SELECT 1 FROM lines l WHERE l.name_id = p.id))');

/** 正文里残留 `#目标(名字)` 形态的点(设计 §8 A9 应为 0) */
export const metaNameGroupRows = (db) => {
  const NAME_GROUP = /#[^\s#]*[^\s#()]\s*\([^()]*\)/;
  return db
    .prepare("SELECT id, meta FROM points WHERE path IS NULL AND instr(meta, '(') > 0 ORDER BY id")
    .all()
    .filter((r) => NAME_GROUP.test(String(r.meta)))
    .map((r) => ({ id: num(r.id), meta: String(r.meta) }));
};

const MD_LINK = /\[[^[\]]+\]\([^()]*\)/g;
const hasBareParen = (s) => /[()]/.test(s.replace(MD_LINK, ''));

/** 存量裸括号扫描(A12):树内段名违规 id + 含括号的 path(真库应为 2 条 md 形态) */
export const bareParenScan = (db) => ({
  tree: db
    .prepare('SELECT id, meta FROM points WHERE path IS NOT NULL ORDER BY id')
    .all()
    .filter((r) => hasBareParen(String(r.meta)))
    .map((r) => num(r.id)),
  parenPaths: db
    .prepare(
      "SELECT id, path FROM points WHERE path IS NOT NULL AND (instr(path,'(')>0 OR instr(path,')')>0) ORDER BY id")
    .all()
    .map((r) => ({ id: num(r.id), path: String(r.path) })),
});

/** 一份读数(判据的唯一输入)。`from`/`to` 给定则附该 (来源, 目标) 的线,供 A5-A7 判状态迁移 */
export const readings = (db, { from, to } = {}) => ({
  counts: {
    points: one(db, 'SELECT COUNT(*) c FROM points'),
    lines: one(db, 'SELECT COUNT(*) c FROM lines'),
    named: one(db, 'SELECT COUNT(*) c FROM lines WHERE name_id IS NOT NULL AND name_id <> 0'),
  },
  named: namedLines(db),
  fts: ftsReading(db),
  namePointFts: namePointFtsRows(db),
  metaNameGroups: metaNameGroupRows(db),
  bareParen: bareParenScan(db),
  line: from == null ? null : lineOf(db, from, to),
});

/** 逐值 + 顺序比对(A1:流序即口径,不排序) */
export function compareIds(label, a, b) {
  const diff = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) diff.push(`${i}: ${a[i] ?? '—'} vs ${b[i] ?? '—'}`);
  }
  return { label, ok: diff.length === 0 && a.length === b.length, a: a.length, b: b.length, diff: diff.slice(0, 5) };
}

/** A2/A10:FTS 必须**行数与 paths 字节都相同**(只比行数会放过「文本漂移」) */
export function compareFts(a, b) {
  const [x, y] = [a.fts, b.fts];
  if (x.rows !== y.rows) return { ok: false, rowsA: x.rows, rowsB: y.rows, shaA: x.sha, shaB: y.sha, reason: '行数不同' };
  return {
    ok: x.sha === y.sha,
    rowsA: x.rows,
    rowsB: y.rows,
    shaA: x.sha,
    shaB: y.sha,
    reason: x.sha === y.sha ? '' : 'paths 字节不同',
  };
}

const key = (r) => `${r.id}|${r.from}|${r.to}|${r.name}`;

/** A4:名线三元组集合逐条不变(线 id 也在键里;按集合比,不看顺序) */
export function judgeRoundtrip(a, b) {
  const [x, y] = [a.named.map(key).sort(), b.named.map(key).sort()];
  const diff = x.filter((k) => !y.includes(k)).concat(y.filter((k) => !x.includes(k)));
  return {
    ok: x.length === y.length && diff.length === 0,
    named: a.named.length,
    after: b.named.length,
    diff: diff.slice(0, 3),
  };
}

/** A5:清名字可表达 —— 线 id 不变、`name_id` 变空、线仍在 */
export const judgeClearName = (a, b) => ({
  ok: !!a.line && !!b.line && b.line.id === a.line.id && b.line.nameId === null && a.line.nameId !== null,
  lineBefore: a.line,
  lineAfter: b.line,
});

/** A6:改名可表达 —— 线 id 不变、`name_id` 换到新名字点 */
export const judgeRename = (a, b) => ({
  ok: !!a.line && !!b.line && b.line.id === a.line.id && b.line.nameId !== null && b.line.nameId !== a.line.nameId,
  lineBefore: a.line,
  lineAfter: b.line,
});

/** A7:删除可表达 —— 该目标的线消失,其它目标的线(line id 与名字)逐条不变 */
export function judgeDelete(a, b) {
  const rest = (r) => r.named.filter((x) => !(x.from === a.line?.from && x.to === a.line?.to)).map(key);
  const kept = a.line ? JSON.stringify(rest(a)) === JSON.stringify(rest(b)) : false;
  return { ok: !!a.line && !b.line && kept, lineBefore: a.line, lineAfter: b.line, keptOthers: rest(b).length };
}

/** A9:正文里没有 `#目标(名字)` 残留 */
export const judgeMetaNameGroup = (r) => ({ ok: r.metaNameGroups.length === 0, rows: r.metaNameGroups });

/** A12:存量裸括号 0 违规 */
export const judgeBareParen = (r) => ({ ok: r.bareParen.tree.length === 0, ...r.bareParen });

/** 副本准备:`snapshot.mjs --snapshot`(VACUUM INTO);同名标记的近期副本默认复用 */
export function makeCopy({ live = LIVE_DB, out = SNAP_DIR, tag = 'relsyntax', force = false } = {}) {
  const existing = existsSync(out)
    ? readdirSync(out).filter((f) => f.startsWith(`lifelog.db.bak-${tag}-`)).sort()
    : [];
  if (existing.length && !force) return `${out}/${existing[existing.length - 1]}`;
  const r = spawnSync(process.execPath, [SNAPSHOT, '--db', live, '--out', out, '--tag', tag, '--snapshot'], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`快照失败(${r.status}):${r.stdout}${r.stderr}`);
  const m = /目标: (.+)/.exec(r.stdout);
  if (!m) throw new Error(`快照输出无法解析:${r.stdout}`);
  return m[1].trim();
}

/** 跑一条 Rust 用例(env 给库路径/步骤);返回 `{code, out}` */
export function runCargoTest(name, env = {}, extra = ['--ignored', '--nocapture']) {
  const r = spawnSync('cargo', ['test', '--lib', '--', ...extra, name], {
    cwd: TAURI,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** 从 cargo 输出里取 `@@RELJSON@@{...}` 读数 */
export function readRelJson(out) {
  const line = out.split('\n').find((l) => l.includes('@@RELJSON@@'));
  if (!line) throw new Error('cargo 输出里没有 @@RELJSON@@ 行');
  return JSON.parse(line.slice(line.indexOf('@@RELJSON@@') + '@@RELJSON@@'.length));
}
