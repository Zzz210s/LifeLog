// 只读校验：用 sql.js 打开真库，跑 buildFiles，打印对账数字。
// 用法：npx tsx scripts/import-check.ts [数据库路径]
import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { buildFiles, LineRow, PointRow } from '../src/import/map';

const DB = process.argv[2] ?? 'C:/Users/23652/AppData/Roaming/com.lifelog.app/libraries/richang/lifelog.db';

async function main() {
const SQL = await initSqlJs({ locateFile: (f: string) => `node_modules/sql.js/dist/${f}` });
const db = new SQL.Database(readFileSync(DB));

function rows<T>(sql: string, map: (v: unknown[]) => T): T[] {
  const res = db.exec(sql);
  if (res.length === 0) return [];
  return res[0].values.map(map);
}

const points = rows<PointRow>(
  'select id, meta, coalesce(created_at, \'\') as created_at, path, parent_id from points',
  (v) => ({
    id: Number(v[0]),
    meta: String(v[1] ?? ''),
    created_at: String(v[2] ?? ''),
    path: v[3] === null || v[3] === undefined ? null : String(v[3]),
    parent_id: v[4] === null || v[4] === undefined ? null : Number(v[4]),
  }),
);

const lines = rows<LineRow>('select from_id, to_id, name_id from lines', (v) => ({
  from_id: Number(v[0]),
  to_id: Number(v[1]),
  name_id: v[2] === null || v[2] === undefined ? null : Number(v[2]),
}));

const { files, stats } = buildFiles(points, lines);

const dbCounts = rows('select count(*) from points', (v) => Number(v[0]))[0];
const noteCount = points.filter((p) => p.path === null).length;

console.log(JSON.stringify({
  dbFile: DB,
  points: dbCounts,
  lines: lines.length,
  pathNull: noteCount,
  stats,
  files: files.length,
  sampleNote: files.find((f) => f.path.includes('/笔记/'))?.path,
  sampleEntity: files.find((f) => f.path.includes('/实体/'))?.path,
  withRelations: files.filter((f) => /\n国籍: |\n所在: |\n状态: /.test(f.content)).length,
}, null, 2));

const dupes = new Set<string>();
for (const f of files) {
  if (dupes.has(f.path)) throw new Error(`重复路径：${f.path}`);
  dupes.add(f.path);
}
console.log('路径唯一性：OK');
}

void main();
