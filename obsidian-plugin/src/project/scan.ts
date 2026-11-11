// 库扫描：只读 vault，产出成员清单与树。全部基于公开 API + frontmatter，禁用插件后数据仍完整。
import { App } from 'obsidian';

export type Member = {
  path: string;
  kind: 'note' | 'entity';
  title: string;
  /** 实体在 `实体/` 下的相对路径（如 `地点/中国大陆`），等于原生 points.path */
  key: string;
  created: string;
  parent: string | null;
  tags: string[];
  rels: { name: string; to: string }[];
};

export type TreeNode = { path: string; name: string; key: string; self: number; subtree: number; children: TreeNode[] };

const RESERVED = new Set(['lifelog_kind', 'lifelog_created', 'lifelog_parent', 'tags', 'aliases', 'cssclasses', 'position']);

export function readMembers(app: App, root: string): Member[] {
  const out: Member[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(`${root}/`)) continue;
    const isNote = f.path.startsWith(`${root}/笔记/`);
    const isEntity = f.path.startsWith(`${root}/实体/`);
    if (!isNote && !isEntity) continue;
    const fm = (app.metadataCache.getFileCache(f)?.frontmatter ?? {}) as Record<string, unknown>;
    const rawTags = fm.tags;
    const tags = Array.isArray(rawTags) ? rawTags.map(String) : typeof rawTags === 'string' ? [rawTags] : [];
    const rels = Object.entries(fm)
      .filter(([k, v]) => !RESERVED.has(k) && typeof v === 'string' && String(v).includes('[['))
      .flatMap(([name, v]) => [...String(v).matchAll(/\[\[([^\]|]+)/g)].map((m) => ({ name, to: m[1] })));
    out.push({
      path: f.path,
      kind: isNote ? 'note' : 'entity',
      title: f.basename,
      key: isEntity ? f.path.slice(`${root}/实体/`.length).replace(/\.md$/, '') : f.basename,
      created: typeof fm.lifelog_created === 'string' ? fm.lifelog_created : '',
      parent: typeof fm.lifelog_parent === 'string' ? fm.lifelog_parent : null,
      tags,
      rels,
    });
  }
  return out;
}

/** 纯数字/年份类实体排在后面（你的库里有一批 `1930`、`1952（出版年份）` 这类） */
const isNumericish = (s: string) => /^[\d\s（）()出版年份年月日.]+$/u.test(s);

/** 实体按 `lifelog_parent`（存的是实体 key，如 `地点/中国大陆`）建树。 */
export function buildTree(members: Member[]): TreeNode[] {
  const ents = members.filter((m) => m.kind === 'entity');
  const nodes = new Map<string, TreeNode>();
  for (const e of ents) nodes.set(e.key, { path: e.path, name: e.title, key: e.key, self: 0, subtree: 0, children: [] });

  const nested = new Set<string>();
  for (const e of ents) {
    if (!e.parent) continue;
    const parentKey = e.parent.replace(/^.*\/实体\//, '').replace(/\.md$/, '');
    const parent = nodes.get(parentKey);
    const child = nodes.get(e.key);
    if (parent && child && parent !== child) {
      parent.children.push(child);
      nested.add(e.key);
    }
  }

  const count = (n: TreeNode): number => {
    n.self = n.children.length;
    n.subtree = n.children.reduce((acc, c) => acc + count(c) + 1, 0);
    return n.subtree;
  };
  const roots = [...nodes.values()].filter((n) => !nested.has(n.key));
  roots.forEach(count);
  const byWeight = (a: TreeNode, b: TreeNode) => {
    const an = isNumericish(a.name) ? 1 : 0;
    const bn = isNumericish(b.name) ? 1 : 0;
    return an - bn || b.subtree - a.subtree || a.name.localeCompare(b.name);
  };
  const walk = (n: TreeNode) => {
    n.children.sort(byWeight);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return roots.sort(byWeight);
}

/** 下标：某实体的关联（子级 + 直接被引用 + 命名关系），供工作台右栏用。 */
export function relatedOf(members: Member[], key: string, name: string): Member[] {
  return members.filter(
    (m) =>
      m.kind === 'note' &&
      (m.tags.includes(key) || m.tags.includes(name) || m.rels.some((r) => r.to === key || r.to === name)),
  );
}
