// 桌面端备用路线：把真库导出成 JSON dump，插件里的导入命令能直接吃它。
// 用法：pnpm dump:db [数据库路径] [输出路径]
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { rowsToDump } from '../src/import/sqlite';

const DB = process.argv[2] ?? 'C:/Users/23652/AppData/Roaming/com.lifelog.app/libraries/richang/lifelog.db';
const OUT = process.argv[3] ?? 'lifelog-dump.json';

async function main() {
  const SQL = await initSqlJs({ locateFile: (f: string) => `node_modules/sql.js/dist/${f}` });
  const db = new SQL.Database(readFileSync(DB));
  const p = db.exec("select id, meta, coalesce(created_at,'') as created_at, path, parent_id from points");
  const l = db.exec('select from_id, to_id, name_id from lines');
  const dump = rowsToDump(p[0]?.values ?? [], l[0]?.values ?? []);
  writeFileSync(OUT, JSON.stringify(dump));
  db.close();
  console.log(`${OUT}: points ${dump.points.length} / lines ${dump.lines.length}`);
}

void main();
