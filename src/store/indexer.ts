// 纯 TS 索引器：不 import obsidian，测试可直跑。
import { PointRecord, isEntityPath } from './schema';

export type Node = { path: string; parent: string | null; id: number };

export type Index = {
  byId: Map<number, PointRecord>;
  byPath: Map<string, PointRecord>;
  entities: Node[];
  notes: PointRecord[];
  tree: Map<string | null, Node[]>;
  counts: Map<string, { self: number; subtree: number }>;
  tags: Map<string, number>;
  links: Map<string, string[]>;
};

const LINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const TAG = /(?:^|\s)#([^\s#[\]]+)/g;

export function buildIndex(records: PointRecord[]): Index {
  const byId = new Map<number, PointRecord>();
  const byPath = new Map<string, PointRecord>();
  const tree = new Map<string | null, Node[]>();
  const tags = new Map<string, number>();
  const links = new Map<string, string[]>();
  const entities: Node[] = [];
  const notes: PointRecord[] = [];

  for (const r of records) {
    if (r.id >= 0) byId.set(r.id, r);
    byPath.set(r.path, r);
    if (isEntityPath(r.path)) {
      const node: Node = { path: r.path, parent: r.parent, id: r.id };
      entities.push(node);
      const bucket = tree.get(r.parent) ?? [];
      bucket.push(node);
      tree.set(r.parent, bucket);
    } else {
      notes.push(r);
    }
    for (const m of r.body.matchAll(TAG)) tags.set(m[1], (tags.get(m[1]) ?? 0) + 1);
    for (const m of r.body.matchAll(LINK)) {
      const key = m[1].trim();
      const bucket = links.get(key) ?? [];
      bucket.push(r.path);
      links.set(key, bucket);
    }
    for (const rel of r.relations) {
      const key = `rel:${rel.name}`;
      const bucket = links.get(key) ?? [];
      bucket.push(`${r.path}->${rel.to}`);
      links.set(key, bucket);
    }
  }

  // 计数：本级 = 直接子节点数；含子级 = 子树内所有实体数（自底向上累加，按路径深度倒序）
  const counts = new Map<string, { self: number; subtree: number }>();
  for (const e of entities) counts.set(e.path, { self: 0, subtree: 0 });
  for (const e of entities) {
    if (e.parent && counts.has(e.parent)) {
      const c = counts.get(e.parent)!;
      c.self += 1;
    }
  }
  const depth = (p: string) => p.split('/').length;
  const ordered = [...entities].sort((a, b) => depth(b.path) - depth(a.path));
  for (const e of ordered) {
    const own = counts.get(e.path)!;
    own.subtree = own.self;
    for (const child of tree.get(e.path === e.path ? e.path : e.path) ?? []) {
      const c = counts.get(child.path);
      if (c) own.subtree += c.subtree;
    }
  }
  return { byId, byPath, entities, notes, tree, counts, tags, links };
}

/** 把 parent 链还原成可读路径，用于和原生 points.path 对账。 */
export function pathOf(index: Index, entityPath: string): string {
  const parts: string[] = [];
  let cur: string | null = entityPath;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    const name = cur.split('/').pop()!.replace(/\.md$/, '');
    parts.unshift(name);
    cur = index.byPath.get(cur)?.parent ? nameOfParent(index, cur) : null;
  }
  return parts.join('/');
}

function nameOfParent(index: Index, entityPath: string): string | null {
  const node = index.byPath.get(entityPath);
  return node?.parent ?? null;
}
