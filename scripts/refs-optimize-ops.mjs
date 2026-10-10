#!/usr/bin/env node
/**
 * 引用优化 A + C 的预览脚本(只允许喂副本;默认 dry-run,--apply 才写)。
 *
 *   A1 删「祖先 + 子孙双挂」的子孙直链:笔记挂了祖先 A,又挂了 A 的后代 B -> 删 (笔记,B)。
 *   A2 删 carry 冗余直链:笔记挂了 A,而 A 或 A 的某祖先沿 `link` 指向 B,笔记又直挂 B -> 删。
 *   A3 合并同名叶子(最终口径 `--a3 final` **只并 1 组** `已完成 -> 状态/已完成`;`--a3 all`
 *      复现预演时的 3 组:另含 游戏/知识+知识 -> 书籍/知识、游戏/科幻 -> 书籍/科幻。
 *      两组「有语义损失」故不并,只在报告里列:知识(游戏 vs 书籍)、科幻(游戏 vs 书籍);
 *      按既有套路:笔记链接取并集、子树重挂并重写 path/depth、写 entity_merge_log、登记旧路径别名)。
 *   C  把值单一的重复标注提升为 tag→tag 关系(旅游×地点轴 10 / 地点×状态 13 / 进度×状态 8),
 *      随后按 A2 同口径删掉笔记侧变冗余的直链。
 *
 * 写前:VACUUM INTO 一份 `*-backup-<stamp>.db`;全量写在单事务里;写完重建 FTS + is_cited 并自检。
 * 真库闸门:--db 命中真库时默认退出码 3;要写真库必须 `--apply --allow-live --snapshot <快照>`,
 *   且快照必须落在快照目录、存在,同时 tasklist 查无 LifeLog.exe;三重不满足即拒绝。
 * 用法: node scripts/refs-optimize-ops.mjs --db <副本路径> [--apply] [--json <路径>]
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tagLabelPlain } from '../src/shared/tag-label-plain.ts';
import { applyWrites } from './refs-optimize-apply.mjs';

const REAL = resolve('C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db').toLowerCase();
const SNAP_DIR = resolve('F:/0-code/_lifelog-snapshots').toLowerCase();
const argv = process.argv.slice(2);
const opt = { db: '', apply: false, allowLive: false, snapshot: '', json: '', a1: 'ancestor', a3: 'final' };
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--db') opt.db = argv[++i];
  else if (argv[i] === '--apply') opt.apply = true;
  else if (argv[i] === '--allow-live') opt.allowLive = true;
  else if (argv[i] === '--snapshot') opt.snapshot = argv[++i];
  else if (argv[i] === '--json') opt.json = argv[++i];
  else if (argv[i] === '--a1') opt.a1 = argv[++i];
  else if (argv[i] === '--a3') opt.a3 = argv[++i];
  else throw new Error(`未知参数: ${argv[i]}`);
}
if (!['descendant', 'ancestor'].includes(opt.a1)) throw new Error('--a1 只接受 descendant(任务书字面)/ ancestor(最终口径:删被后代蕴含的祖先直链)');
if (!['final', 'all'].includes(opt.a3)) throw new Error('--a3 只接受 final(最终口径:只并 已完成)/ all(预演时的 3 组)');
if (!opt.db) {
  console.error('用法: node scripts/refs-optimize-ops.mjs --db <副本路径> [--apply] [--json <路径>]');
  process.exit(2);
}
const target = resolve(opt.db);
if (target.toLowerCase() === REAL) {
  if (!opt.apply || !opt.allowLive) { console.error('拒绝执行:真库需同时给 --apply 与 --allow-live。'); process.exit(3); }
  const snap = opt.snapshot ? resolve(opt.snapshot) : '';
  const snapOk = !!snap && existsSync(snap) && snap.toLowerCase().startsWith(SNAP_DIR);
  const alive = /lifelog\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq LifeLog.exe" /NH', { encoding: 'utf8' }));
  if (!snapOk || alive) {
    console.error(`拒绝执行:真库写前需快照(快照校验=${snapOk} 传入=${snap || '无'})且无 LifeLog 进程(存活=${alive})。`);
    process.exit(3);
  }
  opt.snapshotHash = createHash('sha256').update(readFileSync(snap)).digest('hex');
}
if (!existsSync(target)) { console.error(`找不到库文件: ${target}`); process.exit(2); }
const db = new DatabaseSync(target, { readOnly: !opt.apply });
const vectors = JSON.parse(readFileSync('fixtures/tag-label.json', 'utf8'));
const cases = Array.isArray(vectors) ? vectors : (vectors.cases ?? []);
if (cases.filter((c) => tagLabelPlain(c.raw) !== c.plain).length > 0) { console.error('tag_plain 自检失败(fixtures/tag-label.json 对不上),拒绝执行'); process.exit(3); }
db.function('tag_plain', { deterministic: true }, (raw) => tagLabelPlain(String(raw ?? '')));

const all = (sql, ...a) => db.prepare(sql).all(...a);
const n1 = (sql) => all(`SELECT COUNT(*) c FROM ${sql}`)[0].c;
const ents = new Map(all('SELECT id, meta, path, parent_id, depth FROM entities').map((r) => [r.id, r]));
const nameOf = (id) => (String(ents.get(id)?.meta ?? '').split('\n').find((l) => l.trim()) ?? '').trim();
const isTree = (id) => ents.get(id)?.path != null;
const linkEdges = all("SELECT source_id s, target_id t FROM edges WHERE kind='link'");
const key = (s, t) => `${s}:${t}`;
const live = new Set(linkEdges.map((e) => key(e.s, e.t)));
const outBy = new Map();
for (const e of linkEdges) outBy.set(e.s, [...(outBy.get(e.s) ?? []), e.t]);
const ancCache = new Map();
const ancestors = (id) => {
  if (!ancCache.has(id)) {
    const o = [];
    for (let p = ents.get(id)?.parent_id; p != null; p = ents.get(p)?.parent_id) o.push(p);
    ancCache.set(id, o);
  }
  return ancCache.get(id);
};
const attachedTags = (note) => (outBy.get(note) ?? []).filter((t) => live.has(key(note, t)) && isTree(t));
const deleted = new Map();
const del = (s, t, reason) => {
  if (live.has(key(s, t)) && !deleted.has(key(s, t))) { live.delete(key(s, t)); deleted.set(key(s, t), { s, t, reason }); }
};

// ---------- A1(descendant = 任务书字面:删子孙直链;ancestor = 研究笔记建议:删被蕴含的祖先直链) ----------
for (const e of linkEdges) {
  if (!live.has(key(e.s, e.t)) || isTree(e.s) || !isTree(e.t)) continue;
  if (opt.a1 === 'descendant') {
    if (ancestors(e.t).some((a) => live.has(key(e.s, a)))) del(e.s, e.t, 'A1');
  } else if ((outBy.get(e.s) ?? []).some((d) => d !== e.t && live.has(key(e.s, d)) && isTree(d) && ancestors(d).includes(e.t))) {
    del(e.s, e.t, 'A1');
  }
}
// ---------- A2(C 的连带删除复用同一函数) ----------
const a2 = (reason) => {
  for (const e of linkEdges) {
    if (!live.has(key(e.s, e.t)) || isTree(e.s) || !isTree(e.t)) continue;
    const carriers = attachedTags(e.s).flatMap((a) => [a, ...ancestors(a)]);
    if (carriers.some((c) => c !== e.t && live.has(key(c, e.t)))) del(e.s, e.t, reason);
  }
};
a2('A2');
// ---------- C 候选(值单一 + >=2 篇笔记) ----------
const PROMOS = [
  { a: '旅游', b: '地点轴', remark: '所在' },
  { a: '地点', b: '状态', remark: '状态' },
  { a: '进度', b: '状态', remark: '状态' },
];
const pathId = (p) => [...ents.values()].find((e) => e.path === p)?.id;
const promoted = [];
const skippedMulti = [];
for (const g of PROMOS) {
  const dA = ents.get(pathId(g.a)).depth;
  for (const x of [...ents.values()].filter((e) => e.path?.startsWith(`${g.a}/`) && e.depth === dA + 1)) {
    const notes = [...new Set(linkEdges.filter((e) => e.t === x.id && live.has(key(e.s, e.t)) && !isTree(e.s)).map((e) => e.s))];
    if (notes.length < 2) continue;
    const vals = new Set();
    let missing = 0;
    for (const n of notes) {
      const vs = (outBy.get(n) ?? []).filter((t) => live.has(key(n, t)) && isTree(t) && ents.get(t).path.startsWith(`${g.b}/`));
      if (!vs.length) missing += 1;
      for (const v of vs) vals.add(v);
    }
    if (vals.size === 1 && missing === 0) promoted.push({ ...g, x: x.id, b: [...vals][0], notes, edges: notes.length });
    else skippedMulti.push({ a: g.a, b: g.b, x: x.path, notes: notes.length, values: [...vals].map((v) => ents.get(v).path) });
  }
}
for (const p of promoted) for (const n of p.notes) del(n, p.b, 'C');
// ---------- A3 合并 ----------
const MERGE_SETS = {
  final: [{ target: '状态/已完成', sources: ['已完成'] }],
  all: [
    { target: '书籍/知识', sources: ['游戏/知识', '知识'] },
    { target: '书籍/科幻', sources: ['游戏/科幻'] },
    { target: '状态/已完成', sources: ['已完成'] },
  ],
};
// 有语义损失、最终口径**不并**的两组:游戏类与书籍类同名但不同义(只在报告里列)
const SEMANTIC_GROUPS_NOT_MERGED = [
  { leaf: '知识', paths: ['书籍/知识', '游戏/知识', '知识'], why: '游戏(图灵完备)与书籍知识不同义' },
  { leaf: '科幻', paths: ['书籍/科幻', '游戏/科幻'], why: '游戏(外星反骨仔)与书籍科幻(基地)不同义' },
];
const MERGES = MERGE_SETS[opt.a3].map((m) => ({ ...m, targetId: pathId(m.target), sourceIds: m.sources.map(pathId) }));
if (MERGES.some((m) => !m.targetId || m.sourceIds.some((i) => !i))) throw new Error('库已被本脚本处理过(合并目标缺失);请从原始快照重新拷一份副本');
// 同名叶子组里「只列不并」的:纯时间组与时间/进度混名组
const leafName = (p) => p.split('/').pop();
const kids = new Set([...ents.values()].map((e) => e.parent_id).filter((v) => v != null));
const byName = new Map();
for (const e of ents.values()) if (e.path && !kids.has(e.id)) byName.set(leafName(e.path), [...(byName.get(leafName(e.path)) ?? []), e.path]);
const mergedNames = new Set(MERGES.flatMap((m) => m.sources.concat(m.target)).map(leafName));
const semanticLeaves = new Set(SEMANTIC_GROUPS_NOT_MERGED.map((g) => g.leaf));
const listedOnly = [...byName.entries()]
  .filter(([k, v]) => v.length > 1 && !mergedNames.has(k) && !semanticLeaves.has(k))
  .map(([k, v]) => ({ name: k, paths: v, kind: v.some((p) => p.startsWith('时间/')) && v.some((p) => p.startsWith('进度/')) ? '时间+进度' : '仅时间' }));

// ---------- 计划读数 ----------
const byReason = {};
for (const d of deleted.values()) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
const sample = (reason, n = 30) => [...deleted.values()].filter((d) => d.reason === reason).slice(0, n)
  .map((d) => ({ noteId: d.s, note: nameOf(d.s).slice(0, 30), tag: ents.get(d.t).path }));
const pre = { entities: n1('entities'), tree: n1('entities WHERE path IS NOT NULL'), edges: n1('edges'), link: n1("edges WHERE kind='link'"), fts: n1('entities_fts') };
console.log(`库: ${target}${opt.apply ? '  [--apply 会真写]' : '  [dry-run 不写]'}`);
console.log(`tag_plain 自检通过;改前: entities=${pre.entities} tree=${pre.tree} edges=${pre.edges} link=${pre.link}`);
if (opt.snapshotHash) console.log(`真库写安全闸门通过:快照 ${opt.snapshot} sha256=${opt.snapshotHash.slice(0, 16)}…;tasklist 无 LifeLog 进程`);
console.log(`待删直链 ${deleted.size}(A1=${byReason.A1 ?? 0} A2=${byReason.A2 ?? 0} C=${byReason.C ?? 0});新增关系边 ${promoted.length};合并 ${MERGES.reduce((n, m) => n + m.sourceIds.length, 0)} 个标签`);
for (const p of promoted) console.log(`  C ${ents.get(p.x).path} --(${p.remark})--> ${ents.get(p.b).path}  笔记 ${p.edges} 篇`);
for (const m of MERGES) console.log(`  A3 ${m.sourceIds.map((i) => ents.get(i).path).join(' + ')} -> ${m.target}`);

const report = { db: target, apply: opt.apply, a1Mode: opt.a1, a3Mode: opt.a3, snapshot: opt.snapshot || null, snapshotSha256: opt.snapshotHash ?? null, pre, byReason, addedRelations: promoted.map((p) => ({ from: ents.get(p.x).path, to: ents.get(p.b).path, remark: p.remark, notes: p.edges, noteIds: p.notes })), merges: MERGES.map((m) => ({ target: m.target, sources: m.sources })), semanticGroupsNotMerged: SEMANTIC_GROUPS_NOT_MERGED, skippedMulti, listedOnly, samples: { A1: sample('A1'), A2: sample('A2'), C: sample('C') } };

if (opt.apply) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const backup = `${target}-backup-${stamp}.db`;
  db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  report.backup = backup;
  Object.assign(report, applyWrites(db, { deleted, promoted, MERGES, ents, all, n1 }));
  report.post = { entities: n1('entities'), tree: n1('entities WHERE path IS NOT NULL'), notes: n1('entities WHERE path IS NULL'), edges: n1('edges'), child: n1("edges WHERE kind='child'"), link: n1("edges WHERE kind='link'"), fts: n1('entities_fts'), is_cited_mismatch: n1("entities WHERE is_cited <> (EXISTS(SELECT 1 FROM edges x WHERE x.target_id=entities.id AND x.kind='link'))"), mergeLog: n1('entity_merge_log') };
  console.log(`已写:${target};备份 ${backup}`);
  console.log(`改后: entities=${report.post.entities} tree=${report.post.tree} edges=${report.post.edges} link=${report.post.link} is_cited 不一致=${report.post.is_cited_mismatch}`);
}
if (opt.json) writeFileSync(opt.json, JSON.stringify(report, null, 1));
