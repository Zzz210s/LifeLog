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

// 文件名清洗：换行/制表符会让 Windows 与 Obsidian 都写不出文件（真库演练抓到过 869-大地\n））
const clean = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const slug = (s: string) => clean(s).slice(0, 40) || '未命名';

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
        push(tagsOf, from.id, to.path);
      } else {
        // 用路径而不是文件名：真库里有 309 个重名 basename，用 basename 会解析歧义
        push(linksOf, from.id, `[[${to.path ?? slug(to.meta)}]]`);
      }
      continue;
    }
    const namePoint = byId.get(line.name_id);
    if (!namePoint) continue;
    stats.relations += 1;
    push(relsOf, from.id, { name: namePoint.meta, to: to.path ?? slug(to.meta) });
  }

  const files: FileOut[] = [];
  // 文件名不再带 id；同标题同目录时按「 (2)」递增，保证 2134 个文件路径唯一
  const used = new Set<string>();
  for (const p of points) {
    if (isName(p.id)) continue; // 名字点不进树/图（与原生判据一致）
    const rels = relsOf.get(p.id) ?? [];
    if (p.path) {
      const parent = p.parent_id ? byId.get(p.parent_id) : null;
      const fm = [parent?.path ? `lifelog_parent: ${parent.path}` : null, ...relLines(rels)];
      const path = unique(entityFile(root, p.path), used);
      used.add(path);
      files.push({ path, content: renderFile(fm, `# ${p.path.split('/').pop() ?? p.meta}`) });
      stats.entities += 1;
      continue;
    }
    const d = p.created_at.slice(0, 10);
    const [y, m] = d ? d.split('-') : ['0000', '00'];
    const bodyParts = [p.meta.trim(), ...(linksOf.get(p.id) ?? [])].filter(Boolean);
    const tags = [...new Set(tagsOf.get(p.id) ?? [])].sort();
    const fm = [
      `lifelog_created: ${p.created_at}`,
      tags.length > 0 ? `tags: [${tags.join(', ')}]` : null,
      ...relLines(rels),
    ];
    const base = `${root}/笔记/${y}/${m}/${slug(p.meta)}.md`;
    const path = unique(base, used);
    used.add(path);
    files.push({ path, content: renderFile(fm, bodyParts.join(' ')) });
    stats.notes += 1;
  }
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), stats };
}

/** frontmatter 必须在闭合的 `---` 之前，否则 Obsidian 不把它当属性（真机测试抓到过）。 */
function renderFile(fm: (string | null)[], body: string): string {
  const lines = fm.filter((l): l is string => l !== null);
  const head = lines.length > 0 ? ['---', ...lines, '---'].join('\n') : '';
  const parts = [head, body].filter(Boolean);
  return parts.length > 0 ? `${parts.join('\n\n')}\n` : '';
}

/** 关系名各自成为一个顶层属性（A 方案），多目标折成数组。 */
function relLines(rels: { name: string; to: string }[]): string[] {
  return groupByName(rels).map(
    ([name, targets]) => `${name}: ${targets.length === 1 ? targets[0] : `[${targets.join(', ')}]`}`,
  );
}

function unique(path: string, used: Set<string>): string {
  if (!used.has(path)) return path;
  const i = path.lastIndexOf('.md');
  const stem = i > 0 ? path.slice(0, i) : path;
  for (let n = 2; n < 100; n++) {
    const candidate = `${stem} (${n}).md`;
    if (!used.has(candidate)) return candidate;
  }
  return `${stem} (x).md`;
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
