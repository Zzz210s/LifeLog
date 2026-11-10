// 只做「行 → 文件」的纯映射：不碰 fs、不碰 sqlite，方便单测与在 node 里对账。
export type PointRow = {
  id: number;
  meta: string;
  created_at: string;
  path: string | null;
  parent_id: number | null;
};

export type LineRow = { from_id: number; to_id: number; name_id: number | null };

export type FileOut = { path: string; content: string };

export type Stats = { notes: number; entities: number; tags: number; relations: number; tree: number };

export const TREE_NAME_ID = 0;

const slug = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, '').trim().slice(0, 40) || '未命名';

function entityFile(root: string, path: string): string {
  return `${root}/实体/${path}.md`;
}

export function buildFiles(points: PointRow[], lines: LineRow[], root = '拾枝') {
  const byId = new Map(points.map((p) => [p.id, p]));
  const nameIds = new Set(lines.map((l) => l.name_id).filter((n): n is number => typeof n === 'number' && n > 0));
  const isName = (id: number) => nameIds.has(id);

  const tagsOf = new Map<number, string[]>();
  const linksOf = new Map<number, string[]>();
  const relsOf = new Map<number, { name: string; to: string }[]>();
  const push = <T>(m: Map<number, T[]>, k: number, v: T) => {
    const list = m.get(k) ?? [];
    list.push(v);
    m.set(k, list);
  };

  const stats: Stats = { notes: 0, entities: 0, tags: 0, relations: 0, tree: 0 };
  for (const line of lines) {
    const from = byId.get(line.from_id);
    const to = byId.get(line.to_id);
    if (!from || !to) continue;
    if (line.name_id === TREE_NAME_ID) {
      stats.tree += 1;
      continue;
    }
    if (line.name_id === null) {
      if (to.path) {
        stats.tags += 1;
        push(tagsOf, from.id, `#${to.path}`);
      } else {
        push(linksOf, from.id, `[[${slug(to.meta)}]]`);
      }
      continue;
    }
    const namePoint = byId.get(line.name_id);
    if (!namePoint) continue;
    stats.relations += 1;
    push(relsOf, from.id, { name: namePoint.meta, to: to.path ?? slug(to.meta) });
  }

  const files: FileOut[] = [];
  for (const p of points) {
    if (isName(p.id)) continue; // 名字点不进树/图（与原生判据一致）
    const rels = relsOf.get(p.id) ?? [];
    if (p.path) {
      const parent = p.parent_id ? byId.get(p.parent_id) : null;
      const head = ['---', `lifelog_id: ${p.id}`, parent?.path ? `lifelog_parent: ${parent.path}` : null, '---', ''];
      for (const [name, targets] of groupByName(rels)) {
        head.push(`${name}: ${targets.length === 1 ? targets[0] : `[${targets.join(', ')}]`}`);
      }
      const content = head.filter((l): l is string => l !== null).join('\n') + '\n';
      files.push({ path: entityFile(root, p.path), content });
      stats.entities += 1;
      continue;
    }
    const d = p.created_at.slice(0, 10);
    const [y, m] = d ? d.split('-') : ['0000', '00'];
    const bodyParts = [p.meta.trim(), ...(tagsOf.get(p.id) ?? []), ...(linksOf.get(p.id) ?? [])].filter(Boolean);
    const head = ['---', `lifelog_id: ${p.id}`, `lifelog_created: ${p.created_at}`, '---', ''];
    for (const [name, targets] of groupByName(rels)) {
      head.push(`${name}: ${targets.length === 1 ? targets[0] : `[${targets.join(', ')}]`}`);
    }
    files.push({ path: `${root}/笔记/${y}/${m}/${p.id}-${slug(p.meta)}.md`, content: head.join('\n') + bodyParts.join(' ') + '\n' });
    stats.notes += 1;
  }
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), stats };
}

function groupByName(rels: { name: string; to: string }[]): [string, string[]][] {
  const m = new Map<string, string[]>();
  for (const r of rels) {
    const list = m.get(r.name) ?? [];
    list.push(`"[[${r.to}]]"`);
    m.set(r.name, list);
  }
  return [...m.entries()];
}
