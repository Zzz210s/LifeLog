/** reconcile.sql 的解析器 + 只读执行器（python sqlite3）+ 文本格式化；T0.1 对账脚本的库部分。 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** 解析标记块；标记见 reconcile.sql 头部注释。 */
export function parseBlocks(text) {
  const blocks = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^--\s*@(count|check)\s*\|\s*(.*)$/.exec(line);
    if (!m) {
      if (cur) cur.lines.push(line);
      continue;
    }
    const f = m[2].split('|').map((s) => s.trim());
    if (m[1] === 'count') {
      cur = { kind: 'count', key: f[0], requires: reqs(f[1]), lines: [] };
    } else {
      cur = {
        kind: 'check',
        n: f[0],
        title: f[1],
        mode: f[2],
        requires: reqs(f[3]),
        expect: f[4] || 'zero',
        key: `check:${f[0]}:${f[2]}`,
        lines: [],
      };
    }
    blocks.push(cur);
  }
  for (const b of blocks) b.sql = b.lines.join('\n').trim();
  return blocks.filter((b) => b.sql.length > 0);
}

const reqs = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);

const PY = `import json,sqlite3,sys
db=sys.argv[1].replace(chr(92),'/')
blocks=json.load(sys.stdin)
c=sqlite3.connect('file:'+db+'?mode=ro',uri=True)
tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
out=[]
for b in blocks:
    miss=[t for t in b['requires'] if t not in tables]
    if miss:
        out.append({'key':b['key'],'skipped':True,'missing':miss}); continue
    try:
        cur=c.execute(b['sql'])
        rows=cur.fetchall() if cur.description else []
        out.append({'key':b['key'],'skipped':False,
                    'rows':[[None if v is None else v for v in r] for r in rows]})
    except Exception as e:
        out.append({'key':b['key'],'skipped':False,'error':str(e)})
print(json.dumps({'user_version':c.execute('PRAGMA user_version').fetchone()[0],'results':out},
                 ensure_ascii=False))`;

/** 只读跑一遍 reconcile.sql，返回结构化报告。 */
export function runReconcile({ dbPath, sqlPath }) {
  const blocks = parseBlocks(readFileSync(sqlPath, 'utf8'));
  const payload = blocks.map((b) => ({ key: b.key, sql: b.sql, requires: b.requires }));
  const raw = execFileSync('python', ['-c', PY, dbPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const { user_version: userVersion, results } = JSON.parse(raw);
  const byKey = new Map(results.map((r) => [r.key, r]));
  const counts = {};
  const checks = [];
  for (const b of blocks) {
    const r = byKey.get(b.key) || { skipped: true, missing: ['?'] };
    if (b.kind === 'count') {
      counts[b.key] = r.skipped ? 'N/A' : r.error ? 'ERR' : (r.rows[0] ?? [null])[0];
      continue;
    }
    const entry = { n: b.n, title: b.title, mode: b.mode, expect: b.expect, rowCount: null, rows: [] };
    if (r.skipped) {
      entry.status = 'N/A';
      entry.missing = r.missing;
    } else if (r.error) {
      entry.status = 'ERR';
      entry.error = r.error;
    } else {
      const ok = b.expect === 'ok'
        ? r.rows.length === 1 && String(r.rows[0][0]).toLowerCase() === 'ok'
        : r.rows.length === 0;
      entry.status = ok ? 'PASS' : 'FAIL';
      entry.rowCount = r.rows.length;
      entry.rows = r.rows.slice(0, 5);
    }
    checks.push(entry);
  }
  const summary = {
    pass: checks.filter((c) => c.status === 'PASS').length,
    fail: checks.filter((c) => c.status === 'FAIL' || c.status === 'ERR').length,
    na: checks.filter((c) => c.status === 'N/A').length,
  };
  return { db: dbPath, user_version: userVersion, counts, checks, summary };
}

export const failed = (report) => report.summary.fail > 0;

/** 文本读数（零 emoji，中文）。 */
export function formatReport(report) {
  const L = [];
  L.push('== LifeLog 迁移对账（只读）==');
  L.push(`库: ${report.db}`);
  L.push(`user_version=${report.user_version}`);
  L.push('');
  L.push('[计数读数]');
  for (const [k, v] of Object.entries(report.counts)) L.push(`${k}=${v}`);
  L.push('');
  L.push('[对账] 0 行 / 单行 ok = PASS');
  for (const c of report.checks) {
    L.push(`  [${c.n}] ${c.title}`);
    if (c.status === 'N/A') L.push(`      ${c.mode} N/A (缺表 ${(c.missing || []).join(',')})`);
    else if (c.status === 'ERR') L.push(`      ${c.mode} ERR ${c.error}`);
    else L.push(`      ${c.mode} ${c.status} (${c.rowCount} 行)`);
    for (const row of c.rows) L.push(`        ${JSON.stringify(row)}`);
  }
  L.push('');
  L.push(`对账结果: PASS ${report.summary.pass} / FAIL ${report.summary.fail} / N/A ${report.summary.na}`);
  return L.join('\n');
}
