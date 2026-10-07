// T6 端到端验收共用纯件:树序键(与 Rust `tag_order::ORD_BODY` 同式)、分组键(与
// `notes_group_key::group_key_cte` 同口径)、整表取全、条件构造。只读、不碰库。
// 现场重算一切读数(真库条数会变,不硬编码)。

export const pad6 = (n) => String(n).padStart(6, '0');

/** path -> 树序键:沿父链拼接每级 `sort_order` 的 6 位零填充(与后端 ord 递归 CTE 同表达式) */
export function makeOrd(tags) {
  const so = new Map(tags.map((t) => [t.path, t.sort_order]));
  const cache = new Map();
  const ord = (p) => {
    if (cache.has(p)) return cache.get(p);
    const i = p.lastIndexOf('/');
    const key = i < 0 ? pad6(so.get(p) ?? 0) : `${ord(p.slice(0, i))}/${pad6(so.get(p) ?? 0)}`;
    cache.set(p, key);
    return key;
  };
  return ord;
}

/** 是否落在轴子树里(含轴本级;与后端 substr 前缀谓词同口径) */
export const underAxis = (path, axis) => path === axis || path.startsWith(axis + '/');

/** 轴下的一级子标签路径;命中轴本级时返回轴自身(后端 `slash = 0` 分支) */
export const level1 = (path, axis) =>
  path === axis ? axis : axis + '/' + path.slice(axis.length + 1).split('/')[0];

/** 笔记在轴下树序第一的匹配标签(后端 `MIN(o.key)` / `ROW_NUMBER ... rn=1` 同口径) */
export function axisPick(ord, note, axis) {
  let best = null;
  for (const p of note.tags) {
    if (!underAxis(p, axis)) continue;
    const k = ord(p);
    if (best === null || k < best.key) best = { key: k, path: p };
  }
  return best;
}

export const axisKey = (ord, note, axis) => axisPick(ord, note, axis)?.key ?? null;

/** 分组键(一级子标签);无该轴标签 -> null 哨兵组 */
export function groupKey(ord, note, axis) {
  const hit = axisPick(ord, note, axis);
  return hit === null ? null : level1(hit.path, axis);
}

/** 整表取全(逐页 50,与应用同一 IPC / 同一条件对象) */
export async function allPages(call, conditions) {
  let all = [];
  let off = 0;
  let page;
  do {
    page = await call('query_notes', { conditions, offset: off });
    all = all.concat(page);
    off += 50;
  } while (page.length === 50);
  return all;
}

/** 某组的整组清单(组内续页逐页取全;走应用自己的 `query_group_page`) */
export async function groupPages(call, conditions, groupKeyValue) {
  let all = [];
  let off = 0;
  let page;
  do {
    page = await call('query_group_page', { conditions, groupKey: groupKeyValue, offset: off });
    all = all.concat(page);
    off += 50;
  } while (page.length === 50);
  return all;
}

/** 新形态条件对象(全字段;缺省即空条件) */
export const C = (over = {}) => ({
  keyword: null,
  tags: [],
  excludeTags: [],
  relations: [],
  excludeRelations: [],
  tagPresence: null,
  sort: 'newest',
  sorts: [],
  groupBy: null,
  expr: null,
  groupOp: 'and',
  groups: [],
  ...over,
});

export const tagItem = (path, includeChildren = true) => ({ kind: 'tag', path, includeChildren });
export const tagSort = (path, dir = 'asc', enabled = true) => ({ kind: 'tag', path, dir, enabled });
export const timeSort = (dir = 'desc', enabled = true) => ({ kind: 'time', dir, enabled });
export const oneGroup = (items, op = 'and') => C({ groups: [{ op, items }] });
export const ids = (notes) => notes.map((n) => n.id);
export const sameIds = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export const isSorted = (xs, cmp = (a, b) => a <= b) => xs.every((v, i) => i === 0 || cmp(xs[i - 1], v));
