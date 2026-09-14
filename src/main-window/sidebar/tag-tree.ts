/**
 * 标签树纯函数(spec 6.1 标签分区):扁平行(list_tags,路径序)转嵌套树、
 * 类型过滤(命中保留祖先链)、可选性判定、改名/移动后的条件路径改写。
 * 全部无副作用,可单测;UI 在 TagsSection 里消费。
 */
import type { TagCount } from '../../shared/types';
import type { FilterConditions } from '../../shared/filter-conditions';
import { applyTagPick } from '../filter-chips';

/** 树节点:id 为 null 表示父行缺失时补出的结构节点(不可右键管理) */
export interface TagNode {
  id: number | null;
  path: string;
  name: string;
  depth: number;
  selfCount: number;
  subtreeCount: number;
  children: TagNode[];
}

/** 结构节点补齐标记:insert 后统一自底向上求和 subtreeCount */
interface MutableNode extends TagNode {
  structural: boolean;
}

const makeNode = (id: number | null, path: string, depth: number, structural: boolean): MutableNode => ({
  id,
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  depth,
  selfCount: 0,
  subtreeCount: 0,
  children: [],
  structural,
});

/**
 * 扁平行转树:依赖 list_tags 的路径序返回,但实现不依赖顺序(按路径逐级寻址)。
 * 父行缺失时按路径补结构节点(selfCount 0、id null),其 subtreeCount 由子树求和补齐。
 */
export function buildTree(rows: TagCount[]): TagNode[] {
  const roots: MutableNode[] = [];
  const byPath = new Map<string, MutableNode>();
  for (const row of rows) {
    const segs = row.path.split('/');
    // 逐级补出缺失的祖先(正常数据不会发生,兜底数据不一致)
    let parent: MutableNode | null = null;
    for (let i = 1; i < segs.length; i++) {
      const prefix = segs.slice(0, i).join('/');
      if (!byPath.has(prefix)) {
        const node = makeNode(null, prefix, i, true);
        byPath.set(prefix, node);
        (parent ? parent.children : roots).push(node);
      }
      parent = byPath.get(prefix) ?? null;
    }
    const node = makeNode(row.id ?? null, row.path, row.depth, false);
    node.selfCount = row.self_count;
    node.subtreeCount = row.subtree_count;
    byPath.set(row.path, node);
    (parent ? parent.children : roots).push(node);
  }
  // 结构节点(无真实行)的含子级计数 = 子树求和(子树互斥,直接相加)
  const finalize = (node: MutableNode): void => {
    const kids = node.children as MutableNode[];
    kids.forEach(finalize);
    if (node.structural) {
      node.subtreeCount = kids.reduce((sum, c) => sum + c.subtreeCount, 0);
    }
  };
  roots.forEach(finalize);
  return roots;
}

/**
 * 类型过滤:按完整路径子串匹配(不区分大小写),命中节点的祖先链保留、
 * 未命中的兄弟分支裁掉。空白查询返回原数组(不过滤)。
 */
export function filterTree(nodes: TagNode[], query: string): TagNode[] {
  const q = query.trim().toLowerCase();
  if (q === '') return nodes;
  const walk = (list: TagNode[]): TagNode[] => {
    const out: TagNode[] = [];
    for (const n of list) {
      const children = walk(n.children);
      if (n.path.toLowerCase().includes(q) || children.length > 0) {
        out.push(children.length > 0 ? { ...n, children } : n);
      }
    }
    return out;
  };
  return walk(nodes);
}

/**
 * 可选性(spec 6.1 口径,任务裁定固化):结构节点 = 本级计数为 0 **且有子级** -> 只可展开不可选;
 * 本级 > 0 或没有任何子节点(叶子) -> 可选(无链接的叶子选了结果为空,属预期)。
 * 注:brief 产出的字面公式与此相反且与其自身用例矛盾,以 spec 6.1 为准。
 */
export function isSelectable(node: TagNode): boolean {
  return node.selfCount > 0 || node.children.length === 0;
}

/**
 * 可右键管理(重命名/移动/删除)的节点:id 非 null 的真实标签行。
 * 补出的结构节点(id null)不可管理,侧栏右键不出菜单。
 */
export type ManagedNode = TagNode & { id: number };

/**
 * 侧栏标签行点击的两侧判定(修复轮):路径在排除侧 -> 移除该排除项
 * (用户意图是撤掉这个排除);在引入侧 -> 移除引入;两侧都不在 ->
 * applyTagPick 加入引入侧(含子级)。与 TagPickDialog 的跨侧禁选保持同一不变量:
 * 同一路径永不同时存在两侧(结果恒空无意义)。
 */
export function toggleTagPick(
  c: FilterConditions,
  path: string
): Partial<FilterConditions> {
  if (c.excludeTags.some((t) => t.path === path)) {
    return { excludeTags: c.excludeTags.filter((t) => t.path !== path) };
  }
  if (c.tags.some((t) => t.path === path)) {
    return { tags: c.tags.filter((t) => t.path !== path) };
  }
  return { tags: applyTagPick(c, path, { exclude: false, includeChildren: true }).tags };
}

/**
 * 标签改名/移动成功后改写当前筛选条件里的标签路径(引入与排除两侧都改):
 * `from` 为旧完整路径,命中的 path === from 或以 from + '/' 开头,整段前缀替换为 to。
 * 无命中返回原对象(引用相等,避免触发无谓的重查)。
 */
export function rewriteTagPaths(
  c: FilterConditions,
  from: string,
  to: string
): FilterConditions {
  const rewrite = (path: string): string =>
    path === from ? to : path.startsWith(from + '/') ? to + path.slice(from.length) : path;
  let changed = false;
  const map = (list: typeof c.tags) =>
    list.map((t) => {
      const next = rewrite(t.path);
      if (next === t.path) return t;
      changed = true;
      return { ...t, path: next };
    });
  const tags = map(c.tags);
  const excludeTags = map(c.excludeTags);
  return changed ? { ...c, tags, excludeTags } : c;
}
