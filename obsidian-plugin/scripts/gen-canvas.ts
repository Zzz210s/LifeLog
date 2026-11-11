// 从 dump 生成一个 .canvas（只含实体与命名关系），写到指定路径。
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDump } from '../src/import/sqlite';
import { buildCanvas } from '../src/canvas/build';

const [dumpPath, out, root] = [process.argv[2] ?? 'lifelog-dump.json', process.argv[3] ?? 'out.canvas', process.argv[4] ?? '拾枝'];
const dump = parseDump(readFileSync(dumpPath, 'utf8'));
const byId = new Map(dump.points.map((p) => [p.id, p]));
const entities = dump.points
  .filter((p) => p.path)
  .map((p) => ({ path: p.path!, parentPath: p.parent_id ? byId.get(p.parent_id)?.path ?? null : null }));
const relations = dump.lines
  .filter((l) => l.name_id && l.name_id > 0)
  .map((l) => {
    const from = byId.get(l.from_id)?.path;
    const to = byId.get(l.to_id)?.path;
    const name = byId.get(l.name_id!)?.meta ?? '';
    return from && to ? { from, to, name } : null;
  })
  .filter((r): r is { from: string; to: string; name: string } => r !== null);
const doc = buildCanvas(entities, relations, new Map(), root);
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`${out}: nodes ${doc.nodes.length} / edges ${doc.edges.length}（关系边 ${doc.edges.filter((e) => e.label).length}）`);
