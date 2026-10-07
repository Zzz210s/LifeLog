#!/usr/bin/env node
/** T1.3 阶段 1 只读 smoke:在真库副本上给出「新表投影 == 老表」与「老读方照常跑」的读数。
 *
 * 用法: node scripts/entity-migration/phase1-smoke.mjs [--pre <v23.db>] [--post <v24.db>] [--json]
 *   --pre   迁移前(v23)副本;默认取 T1.1 的迁移前快照(阶段 1 真库基线)
 *   --post  迁移后(v24)库;默认真库(只读打开)
 * 前置/后置都经 python sqlite3 `mode=ro` 打开,绝不写库。任一 FAIL -> 退出码 1。
 * 投影等价的 Rust 逐值用例见 src-tauri/src/db/entities_phase1_tests.rs。 */
import { execFileSync } from 'node:child_process';

const PRE_DEFAULT = 'F:/0-code/_lifelog-snapshots/lifelog.db.bak-p01-20261007T114856Z';
const POST_DEFAULT = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';

/** 迁移前的老触发器集合(记忆 #1290),升序;与 Rust 用例同一份清单 */
const LEGACY_TRIGGERS = [
  'notes_ad', 'notes_ai', 'notes_au',
  'tag_aliases_ad', 'tag_aliases_ai', 'tag_aliases_au',
  'tag_links_ad', 'tag_links_ai',
];

/** 老读方会读到的五张老表全列摘要(行序确定,逐行 repr 拼接后取 sha256) */
const LEGACY_TABLES = {
  tags: "SELECT id||'|'||name||'|'||COALESCE(parent_id,'-')||'|'||path||'|'||depth||'|'||sort_order||'|'||COALESCE(color,'-') FROM tags ORDER BY id",
  tag_links: "SELECT tag_id||'|'||target_type||'|'||target_id||'|'||remark FROM tag_links ORDER BY tag_id, target_type, target_id",
  notes: "SELECT id||'|'||content||'|'||created_at FROM notes ORDER BY id",
  notes_fts: "SELECT rowid||'|'||content||'|'||tags FROM notes_fts ORDER BY rowid",
  tag_aliases: "SELECT alias||'|'||tag_id FROM tag_aliases ORDER BY alias",
};

/** 应用自身的只读查询路径:`tags::counts`(标签树面板数据源)的 SQL,逐字取自 repos/tags/query.rs */
const TREE_SQL = `WITH RECURSIVE sub(root, leaf) AS (
    SELECT id, id FROM tags
    UNION ALL SELECT s.root, t.id FROM tags t JOIN sub s ON t.parent_id = s.leaf
  ),
  own AS (SELECT tag_id, COUNT(DISTINCT target_id) AS n FROM tag_links
          WHERE target_type = 'note' GROUP BY tag_id),
  roll AS (SELECT sub.root AS root, COUNT(DISTINCT l.target_id) AS n
           FROM sub JOIN tag_links l ON l.tag_id = sub.leaf AND l.target_type = 'note'
           GROUP BY sub.root)
  SELECT t.id, t.path, t.depth, t.sort_order, COALESCE(own.n, 0), COALESCE(roll.n, 0)
  FROM tags t LEFT JOIN own ON own.tag_id = t.id LEFT JOIN roll ON roll.root = t.id
  ORDER BY t.path`;

/** 投影双向 EXCEPT:差异行数即读数(与 Rust 用例同口径,id/parent_id 用减法换算) */
const PROJECTION_FWD = `SELECT t.id, t.name, t.path, t.depth, t.sort_order, t.parent_id FROM tags t
  EXCEPT SELECT e.id - 1000000000, e.name, e.path, e.depth, e.sort_order, e.parent_id - 1000000000
  FROM entities e WHERE e.kind='tag'`;
const PROJECTION_BWD = `SELECT e.id - 1000000000, e.name, e.path, e.depth, e.sort_order, e.parent_id - 1000000000
  FROM entities e WHERE e.kind='tag'
  EXCEPT SELECT t.id, t.name, t.path, t.depth, t.sort_order, t.parent_id FROM tags t`;

const PY = `import hashlib,json,sys
payload=json.load(sys.stdin)
def open_ro(p):
    return __import__('sqlite3').connect('file:'+p+'?mode=ro',uri=True)
def sha(rows):
    return hashlib.sha256('\\n'.join(repr(tuple(r)) for r in rows).encode()).hexdigest()[:16]
def shape(c):
    v=c.execute('PRAGMA user_version').fetchone()[0]
    tabs={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    out={'user_version':v,'tables':sorted(tabs),'triggers':[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")]}
    for t in ('notes','note_links'):
        out[t+'_cols']=[(r[1],r[2]) for r in c.execute("PRAGMA table_info('%s')"%t)] if t in tabs else None
    out['legacy']={k:[len(rs),sha(rs)] for k,(rs) in
        ((k,c.execute(s).fetchall()) for k,s in payload['legacy'].items())}
    tree=c.execute(payload['tree']).fetchall()
    out['tree']=[len(tree),sha(tree)]
    out['tag_sample']={'first':c.execute('SELECT id,name,path,depth,sort_order,parent_id FROM tags ORDER BY id LIMIT 3').fetchall(),
                       'last':c.execute('SELECT id,name,path,depth,sort_order,parent_id FROM tags ORDER BY id DESC LIMIT 3').fetchall()}
    if 'entities' in tabs and 'edges' in tabs:
        out['counts']={'entities_tag':c.execute("SELECT COUNT(*) FROM entities WHERE kind='tag'").fetchone()[0],
                       'edges_child':c.execute("SELECT COUNT(*) FROM edges WHERE kind='child'").fetchone()[0],
                       'edges_relation':c.execute("SELECT COUNT(*) FROM edges WHERE kind='relation'").fetchone()[0],
                       'edges_tagging':c.execute("SELECT COUNT(*) FROM edges WHERE kind='tagging'").fetchone()[0]}
        out['projection']={'fwd':len(c.execute(payload['fwd']).fetchall()),'bwd':len(c.execute(payload['bwd']).fetchall())}
    else:
        out['counts']=None; out['projection']=None
    return out
print(json.dumps({'pre':shape(open_ro(payload['pre'])),'post':shape(open_ro(payload['post']))},ensure_ascii=False))`;

function parseArgs(argv) {
  const o = { pre: PRE_DEFAULT, post: POST_DEFAULT, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--pre') o.pre = argv[++i];
    else if (argv[i] === '--post') o.post = argv[++i];
    else if (argv[i] === '--json') o.json = true;
    else throw new Error(`未知参数: ${argv[i]}(--pre / --post / --json)`);
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const raw = execFileSync('python', ['-c', PY], {
  input: JSON.stringify({ pre: opts.pre, post: opts.post, legacy: LEGACY_TABLES,
    tree: TREE_SQL, fwd: PROJECTION_FWD, bwd: PROJECTION_BWD }),
  encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
});
const { pre, post } = JSON.parse(raw);

/** 一项判定:ok 为 null 表示 N/A(前置库缺表) */
const rows = [];
const add = (name, ok, detail) => rows.push({ name, ok, detail });
add('投影等价 正向(老表 -> 新表) 差异行', post.projection && post.projection.fwd === 0,
  post.projection ? `${post.projection.fwd} 行` : 'N/A(后置库无 entities)');
add('投影等价 反向(新表 -> 老表) 差异行', post.projection && post.projection.bwd === 0,
  post.projection ? `${post.projection.bwd} 行` : 'N/A(后置库无 entities)');
for (const t of Object.keys(LEGACY_TABLES)) {
  const a = JSON.stringify(pre.legacy[t]); const b = JSON.stringify(post.legacy[t]);
  add(`老表 ${t} 计数+全列摘要不变`, a === b, `pre=${a} post=${b}`);
}
add('标签树读数(tags::counts)不变', JSON.stringify(pre.tree) === JSON.stringify(post.tree),
  `pre=${pre.tree} post=${post.tree}`);
add('触发器集合仍是 8 个老名字',
  JSON.stringify(post.triggers) === JSON.stringify(LEGACY_TRIGGERS), post.triggers.join(','));
add('notes 列集合不变', JSON.stringify(pre.notes_cols) === JSON.stringify(post.notes_cols),
  `${JSON.stringify(post.notes_cols)}`);
add('note_links 列集合不变', JSON.stringify(pre.note_links_cols) === JSON.stringify(post.note_links_cols),
  `${JSON.stringify(post.note_links_cols)}`);
if (post.counts) {
  add('entities(kind=tag) == 迁移前 tags 行数', post.counts.entities_tag === pre.legacy.tags[0],
    `${post.counts.entities_tag} vs ${pre.legacy.tags[0]}`);
  add('edges(kind=child) > 0', post.counts.edges_child > 0, `${post.counts.edges_child} 行`);
}

const report = { pre: opts.pre, post: opts.post, pre_version: pre.user_version,
  post_version: post.user_version, counts: post.counts, checks: rows, tag_sample: post.tag_sample };
if (opts.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('== 阶段 1 smoke(只读)==');
  console.log(`前置(v23): ${opts.pre}  user_version=${pre.user_version}`);
  console.log(`后置(v24): ${opts.post}  user_version=${post.user_version}`);
  if (post.counts) console.log(`计数: ${JSON.stringify(post.counts)}`);
  console.log('[标签首尾 3 行] 首个: ' + JSON.stringify(post.tag_sample.first[0]));
  console.log('              末尾: ' + JSON.stringify(post.tag_sample.last[0]));
  for (const r of rows) console.log(`  [${r.ok === null ? 'N/A' : r.ok ? 'PASS' : 'FAIL'}] ${r.name}: ${r.detail}`);
  console.log(`结果: PASS ${rows.filter((r) => r.ok === true).length} / FAIL ${rows.filter((r) => r.ok === false).length}`);
}
process.exit(rows.some((r) => r.ok === false) ? 1 : 0);
