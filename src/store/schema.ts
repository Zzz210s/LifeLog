// 点/线的 frontmatter 契约。插件、导入器、Bases 模板三方共用这一份键名。
export const KEY = {
  id: 'lifelog_id',
  created: 'lifelog_created',
  parent: 'lifelog_parent',
  relations: 'lifelog_relations',
} as const;

export type Relation = { name: string; to: string };

export type PointRecord = {
  path: string;
  id: number;
  createdAt: string;
  parent: string | null;
  relations: Relation[];
  body: string;
};

export function isEntityPath(p: string): boolean {
  return p.includes('/实体/');
}

export function isNotePath(p: string): boolean {
  return p.includes('/笔记/');
}

function toRelation(v: unknown): Relation | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.name !== 'string' || typeof r.to !== 'string') return null;
  return { name: r.name, to: r.to };
}

/** frontmatter 可能是 undefined / 空 / 字符串；这里只做形状收敛，不做校验。 */
export function readRecord(path: string, fm: Record<string, unknown> | undefined, body: string): PointRecord {
  const raw = fm ?? {};
  const id = typeof raw[KEY.id] === 'number' ? (raw[KEY.id] as number) : Number(raw[KEY.id] ?? NaN);
  const createdAt = typeof raw[KEY.created] === 'string' ? (raw[KEY.created] as string) : '';
  const parent = typeof raw[KEY.parent] === 'string' ? (raw[KEY.parent] as string) : null;
  const relRaw = Array.isArray(raw[KEY.relations]) ? (raw[KEY.relations] as unknown[]) : [];
  return {
    path,
    id: Number.isFinite(id) ? id : -1,
    createdAt,
    parent,
    relations: relRaw.map(toRelation).filter((r): r is Relation => r !== null),
    body,
  };
}

/** 由 id + 首行生成笔记路径（年份/月取自 createdAt）。 */
export function notePath(id: number, title: string, createdAt: string, root: string): string {
  const d = createdAt.slice(0, 10);
  const [y, m] = d ? d.split('-') : ['0000', '00'];
  const safe = title.replace(/[\/:*?"<>|#^[\]]/g, '').trim().slice(0, 40) || '未命名';
  return `${root}/笔记/${y}/${m}/${id}-${safe}.md`;
}
