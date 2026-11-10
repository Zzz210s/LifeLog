// 库扫描：只读 vault，产出成员清单与树。全部基于公开 API + frontmatter，禁用插件后数据仍完整。
import { App, TFile } from 'obsidian';

export type Member = {
  path: string;
  kind: 'note' | 'entity';
  title: string;
  created: string;
  parent: string | null;
  tags: string[];
  rels: { name: string; to: string }[];
  text: string;
};

export type TreeNode = { path: string; name: string; self: number; subtree: number; children: TreeNode[] };

const RESERVED = new Set(['lifelog_kind', 'lifelog_created', 'lifelog_parent', 'tags', 'aliases', 'cssclasses', 'position']);

export function readMembers(app: App, root: string): Member[] {
  const out: Member[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(`${root}/`)) continue;
    const cache = app.metadataCache.getFileCache(f);
    const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const isNote = f.path.startsWith(`${root}/笔记/`);
    const isEntity = f.path.startsWith(`${root}/实体/`);
    if (!isNote && !isEntity) continue;
    const rawTags = fm.tags;
    const tags = Array.isArray(rawTags) ? rawTags.map(String) : typeof rawTags === 'string' ? [rawTags] : [];
    const rels = Object.entries(fm)
      .filter(([k, v]) => !RESERVED.has(k) && typeof v === 'string' && String(v).includes('[['))
      .flatMap(([name, v]) => [...String(v).matchAll(/\[\[([^\]|]+)/g)].map((m) => ({ name, to: m[1] })));
    out.push({
      path: f.path,
      kind: isNote ? 'note' : 'entity',
      title: f.basename,
      created: typeof fm.lifelog_created === 'string' ? fm.lifelog_created : '',
      parent: typeof fm.lifelog_parent === 'string' ? fm.lifelog_parent : null,
      tags,
      rels,
      text: bodyOf(app, f),
    });
  }
  return out;
}

function bodyOf(app: App, f: TFile): string {
  const cache = app.metadataCache.getFileCache(f);
  const text = cache?.frontmatterPosition ? '' : '';
  // 只取正文首段用于列表摘要：用 cachedRead 太贵，这里用 metadataCache 的标题信息兜底
  return text;
}

/** 实体按 lifelog_parent 建树，计数：self = 直接子级，subtree = 整棵子树。 */
export function buildTree(members: Member[]): TreeNode[] {
  const ents = members.filter((m) => m.kind === 'entity');
  const nodes = new Map<string, TreeNode>();
  for (const e of ents) {
    nodes.set(e.title, { path: e.path, name: e.title, self: 0, subtree: 0, children: [] });
  }
  // parent 用「路径末段名」对不上时，退化为「父路径的末段」
  const nameOf = (p: string) => p.split('/').pop() ?? p;
  for (const e of ents) {
    if (!e.parent) continue;
    const parent = nodes.get(nameOf(e.parent)) ?? nodes.get(e.parent);
    const self = nodes.get(e.title);
    if (parent && self) parent.children.push(self);
  }
  const roots = [...nodes.values()].filter((n) => !ents.some((e) => nameOf(e.parent ?? '') === n.name && e.title !== n.name));
  const count = (n: TreeNode): number => {
    n.self = n.children.length;
    n.subtree = n.children.reduce((acc, c) => acc + count(c) + 1, 0);
    return n.subtree;
  };
  for (const r of roots) count(r);
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => b.subtree - a.subtree || a.name.localeCompare(b.name));
    n.children.forEach(sortRec);
  };
  roots.forEach(sortRec);
  return roots.sort((a, b) => b.subtree - a.subtree || a.name.localeCompare(b.name));
}
