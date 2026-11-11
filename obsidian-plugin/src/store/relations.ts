// 有名关系存成「顶层属性 = 关系名」：`国籍: "[[地点/日本]]"`。
// 这样每一类关系在 Obsidian 里就是**一种 link type**（Extended Graph 可按类型着色/过滤），
// 而 `lifelog_relations` 只作为给 Bases 看的镜像（单列，方便列表与分组）。
import { PointRecord } from './schema';

export type Relation = { name: string; to: string };

/** 与插件相关的保留键；其余带 wiki 链接值的属性都视为关系。 */
export const RESERVED = new Set([
  'lifelog_id',
  'lifelog_created',
  'lifelog_parent',
  'lifelog_relations',
  'tags',
  'aliases',
  'cssclasses',
  'publish',
  'permalink',
  'description',
]);

const WIKI = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

function wikiTargets(value: unknown): string[] {
  const one = (v: unknown): string[] => {
    if (typeof v !== 'string') return [];
    return [...v.matchAll(WIKI)].map((m) => m[1].trim());
  };
  if (Array.isArray(value)) return value.flatMap(one);
  return one(value);
}

/** 从 frontmatter 收集关系：优先读 A 方案的动态属性，兼容旧的 `lifelog_relations` 数组。 */
export function relationsOf(fm: Record<string, unknown> | undefined): Relation[] {
  const raw = fm ?? {};
  const out: Relation[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (RESERVED.has(key)) continue;
    for (const to of wikiTargets(value)) out.push({ name: key, to });
  }
  if (out.length > 0) return out;
  const legacy = raw.lifelog_relations;
  if (!Array.isArray(legacy)) return out;
  for (const item of legacy) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.name === 'string' && typeof r.to === 'string') {
      const t = wikiTargets(r.to)[0] ?? r.to.trim();
      out.push({ name: r.name, to: t });
    }
  }
  return out;
}

/** 写回用：把关系折成两类结构（动态属性 + Bases 镜像）。 */
export function relationFields(relations: Relation[]): Record<string, string | string[]> {
  const byName = new Map<string, string[]>();
  for (const r of relations) {
    const list = byName.get(r.name) ?? [];
    list.push(`[[${r.to}]]`);
    byName.set(r.name, list);
  }
  const fields: Record<string, string | string[]> = {};
  for (const [name, targets] of byName) {
    if (RESERVED.has(name)) continue;
    fields[name] = targets.length === 1 ? targets[0] : targets;
  }
  if (relations.length > 0) {
    fields.lifelog_relations = relations.map((r) => `${r.name}: [[${r.to}]]`);
  }
  return fields;
}

export type { PointRecord };
