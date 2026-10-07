#!/usr/bin/env node
/** T0.1 快照脚本：VACUUM INTO 生成单文件快照（记忆 #1267：WAL 模式下不能只复制 .db）。
 *  用法: node scripts/entity-migration/snapshot.mjs [--db <path>] [--tag <pNN>] [--out <dir>] [--snapshot]
 *  默认 dry-run（只读、只打印计划）；加 --snapshot 才落盘。源库一律 mode=ro 打开。 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DB = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
const DEFAULT_OUT = 'F:/0-code/_lifelog-snapshots';

const PY = `import os,sqlite3,sys
src=sys.argv[1].replace(chr(92),'/'); dst=sys.argv[2]
c=sqlite3.connect('file:'+src+'?mode=ro',uri=True)
c.execute('VACUUM INTO ?',(dst,))
c.close()
print(os.path.getsize(dst))`;

function parseArgs(argv) {
  const o = { db: DEFAULT_DB, tag: 'p00', out: DEFAULT_OUT, snapshot: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--db') o.db = argv[++i];
    else if (a === '--tag') o.tag = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--snapshot') o.snapshot = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`未知参数: ${a}（--db / --tag / --out / --snapshot）`);
  }
  return o;
}

const USAGE = `用法: node scripts/entity-migration/snapshot.mjs [--db <path>] [--tag <pNN>] [--out <dir>] [--snapshot]
  --db        源库（默认真库，只读打开）
  --tag       快照阶段标记，默认 p00（阶段 1/2/3/4 用 p24/p25/p26/p27）
  --out       快照目录，默认 F:/0-code/_lifelog-snapshots
  --snapshot  真正落盘（不加则 dry-run，只打印目标路径）
说明: VACUUM INTO 生成单文件；目标已存在则拒绝覆盖。`;

const stat = (p) => (existsSync(p) ? `${statSync(p).size} 字节` : '不存在');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!existsSync(opts.db)) {
  console.error(`源库不存在: ${opts.db}`);
  process.exit(2);
}
const dest = join(opts.out, `lifelog.db.bak-${opts.tag}-${stamp()}`);
console.log('== LifeLog 迁移快照 ==');
console.log(`源库: ${opts.db} (${stat(opts.db)})`);
console.log(`WAL : ${opts.db}-wal (${stat(`${opts.db}-wal`)})`);
console.log(`目标: ${dest}`);

if (!opts.snapshot) {
  console.log('模式: dry-run（未写盘）；确认后加 --snapshot 执行 VACUUM INTO');
  process.exit(0);
}
if (existsSync(dest)) {
  console.error(`目标已存在，拒绝覆盖: ${dest}`);
  process.exit(2);
}
const bytes = execFileSync('python', ['-c', PY, opts.db, dest], {
  encoding: 'utf8',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
}).trim();
console.log(`模式: 已写盘 VACUUM INTO；快照大小 ${bytes} 字节`);
console.log(`源库未改动（mode=ro 只读打开）`);
