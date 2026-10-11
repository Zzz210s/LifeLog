/** T1.5 三条等价性比对器（spec §10.6 硬断言）与只读打开助手。
 *  比对对象是 **id 集合** 与 **paths 字节**，读数口径与 reconcile.sql 一致：
 *    v30 走 entities / edges(kind) / entities_fts；v31 走 points / lines(name_id) / points_fts。
 *  只读：调用方传 DatabaseSync 句柄，本文件不写任何库。 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

/** 树闭包（v30）：is_cited ∪ 沿 child 边上溯。 */
export const CLOSURE_V30 = `WITH RECURSIVE c(id) AS (
  SELECT id FROM entities WHERE is_cited = 1
  UNION SELECT x.source_id FROM edges x JOIN c ON c.id = x.target_id WHERE x.kind = 'child')
SELECT id FROM c ORDER BY id`;

/** 树闭包（v31）：is_cited ∪ 沿子级线（name_id = 0）上溯。 */
export const CLOSURE_V31 = `WITH RECURSIVE c(id) AS (
  SELECT id FROM points WHERE is_cited = 1
  UNION SELECT x.from_id FROM lines x JOIN c ON c.id = x.to_id WHERE x.name_id = 0)
SELECT id FROM c ORDER BY id`;

/** 变异自证用：v31 的 is_cited 集合（闭包的真子集，不能拿来当闭包比对对象）。 */
export const IS_CITED_V31 = 'SELECT id FROM points WHERE is_cited = 1 ORDER BY id';

/** 信息流默认筛选（v30）：闭包内单行点被排除，其余全收。 */
export const FEED_V30 = `WITH RECURSIVE c(id) AS (
  SELECT id FROM entities WHERE is_cited = 1
  UNION SELECT x.source_id FROM edges x JOIN c ON c.id = x.target_id WHERE x.kind = 'child')
SELECT e.id FROM entities e
 WHERE NOT (e.id IN (SELECT id FROM c) AND instr(e.meta, char(10)) = 0) ORDER BY e.id`;

/** 信息流默认筛选（v31）：与 reconcile.sql 的 feed_default_points 同口径（先排纯名字点）。 */
export const FEED_V31 = `WITH RECURSIVE c(id) AS (
  SELECT id FROM points WHERE is_cited = 1
  UNION SELECT x.from_id FROM lines x JOIN c ON c.id = x.to_id WHERE x.name_id = 0)
SELECT p.id FROM points p
 WHERE NOT (EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id)
            AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = p.id OR t.to_id = p.id))
   AND NOT (p.id IN (SELECT id FROM c) AND instr(p.meta, char(10)) = 0) ORDER BY p.id`;

/** 只读打开（URI + readOnly）；用完 close。 */
export const openRO = (path) => new DatabaseSync('file:' + path, { readOnly: true });

/** 库版本（只读 PRAGMA）。 */
export const userVersion = (db) => db.prepare('PRAGMA user_version').get().user_version;

const ids = (db, sql) => db.prepare(sql).all().map((r) => Number(r.id));

/** 两个 id 集合逐 id 比对；不等时给出前 10 个差异 id。 */
export function compareIdSets(label, dbA, sqlA, dbB, sqlB) {
  const a = ids(dbA, sqlA);
  const b = ids(dbB, sqlB);
  const sa = new Set(a);
  const sb = new Set(b);
  const onlyA = a.filter((x) => !sb.has(x));
  const onlyB = b.filter((x) => !sa.has(x));
  return {
    label, ok: a.length === b.length && onlyA.length === 0 && onlyB.length === 0,
    aCount: a.length, bCount: b.length, onlyA: onlyA.slice(0, 10), onlyB: onlyB.slice(0, 10),
    onlyATotal: onlyA.length, onlyBTotal: onlyB.length,
  };
}

/** ① 树闭包：v30 闭包 vs v31 闭包。`leftDb`/`leftSql` 仅供变异自证替换比对对象
 *  （例：换成 v31 的 is_cited 集合 -> 3 对 1，必须红）。 */
export const compareTreeClosure = (dbV30, dbV31, leftDb = dbV30, leftSql = CLOSURE_V30) =>
  compareIdSets('树闭包', leftDb, leftSql, dbV31, CLOSURE_V31);

/** ② 信息流默认筛选：v30 vs v31。`sqlV31` 仅供变异自证替换比对对象。 */
export const compareFeedDefault = (dbV30, dbV31, sqlV31 = FEED_V31) =>
  compareIdSets('信息流默认筛选', dbV30, FEED_V30, dbV31, sqlV31);

const sha256 = (rows) => {
  const chunks = rows.map((r) => Buffer.from(`${r.id}\u0000${r.paths ?? ''}\u0001`, 'utf8'));
  return createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
};

/** ③ FTS：逐 id 比 paths 的 UTF-8 字节（行集合与行数也须相同）。 */
export function compareFtsPaths(dbV30, dbV31) {
  const a = dbV30.prepare('SELECT rowid AS id, paths FROM entities_fts ORDER BY rowid').all();
  const b = dbV31.prepare('SELECT rowid AS id, paths FROM points_fts ORDER BY rowid').all();
  const mb = new Map(b.map((r) => [Number(r.id), r.paths]));
  const diff = a.filter((r) => {
    const id = Number(r.id);
    return !mb.has(id) || Buffer.compare(Buffer.from(String(r.paths ?? ''), 'utf8'),
      Buffer.from(String(mb.get(id) ?? ''), 'utf8')) !== 0;
  });
  const onlyB = b.filter((r) => !a.some((x) => Number(x.id) === Number(r.id)));
  const hashV30 = sha256(a);
  const hashV31 = sha256(b);
  return {
    label: 'FTS paths（逐字节）', ok: hashV30 === hashV31 && a.length === b.length,
    rowsV30: a.length, rowsV31: b.length, hashV30, hashV31,
    diffIds: diff.slice(0, 10).map((r) => Number(r.id)), diffTotal: diff.length, onlyBTotal: onlyB.length,
  };
}

/** 一条等价性的中文读数行。 */
export const formatEq = (r) => {
  const bits = [`[${r.ok ? 'PASS' : 'FAIL'}] ${r.label}`];
  if (r.aCount !== undefined) bits.push(`v30=${r.aCount} v31=${r.bCount} 差 v30独有=${r.onlyATotal} v31独有=${r.onlyBTotal}`);
  if (r.rowsV30 !== undefined) bits.push(`行 v30=${r.rowsV30} v31=${r.rowsV31} 差异行=${r.diffTotal}`);
  if (!r.ok && r.diffIds?.length) bits.push(`差异 id=${JSON.stringify(r.diffIds)}`);
  return bits.join(' | ');
};
