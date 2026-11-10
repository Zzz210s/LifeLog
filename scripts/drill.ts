// 真库 → 沙盒 vault 的真实落盘（不走 Obsidian，只验证 map + 文件系统这一环）。
// 用法：npx tsx scripts/drill.ts <dump.json> <vaultRoot>
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildFiles } from '../src/import/map';
import { parseDump } from '../src/import/sqlite';

const dumpPath = process.argv[2] ?? 'lifelog-dump.json';
const vault = process.argv[3] ?? 'F:/0-code/20-active/obsidian-sandbox';

const dump = parseDump(readFileSync(dumpPath, 'utf8'));
const { files, stats } = buildFiles(dump.points, dump.lines, '拾枝');

let created = 0;
let dupes = 0;
for (const f of files) {
  const abs = join(vault, f.path);
  if (existsSync(abs)) {
    dupes += 1;
    continue;
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, f.content, 'utf8');
  created += 1;
}
console.log(JSON.stringify({ stats, files: files.length, created, dupes }, null, 2));
