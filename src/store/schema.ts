// 点/线的 frontmatter 契约。插件、导入器、Bases 模板三方共用这一份键名。
import { Relation, relationsOf } from './relations';
export const KEY = {
  id: 'lifelog_id',
  created: 'lifelog_created',
  parent: 'lifelog_parent',
  relations: 'lifelog_relations',
} as const;

export type { Relation } from './relations';

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

/** 目标一律存成 wiki 链接字符串 `[[地点/日本]]`，这样 Obsidian 原生关系图能画出这条边。 */
const WIKI = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/;

export function normalizeTarget(raw: string): string {
  const m = raw.trim().match(WIKI);
  return (m ? m[1] : raw).trim();
}

/** frontmatter 可能是 undefined / 空 / 字符串；这里只做形状收敛，不做校验。 */
export function readRecord(path: string, fm: Record<string, unknown> | undefined, body: string): PointRecord {
  const raw = fm ?? {};
  const id = typeof raw[KEY.id] === 'number' ? (raw[KEY.id] as number) : Number(raw[KEY.id] ?? NaN);
  const createdAt = typeof raw[KEY.created] === 'string' ? (raw[KEY.created] as string) : '';
  const parent = typeof raw[KEY.parent] === 'string' ? (raw[KEY.parent] as string) : null;
  return {
    path,
    id: Number.isFinite(id) ? id : -1,
    createdAt,
    parent,
    relations: relationsOf(raw),
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
