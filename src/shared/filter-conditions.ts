/**
 * 结构化筛选条件(D6:真源是条件对象,不是表达式字符串)。
 * 与 Rust `db/repos/notes_filter.rs` 的 `FilterConditions` 等价,JSON 字段名 camelCase 一一对应;
 * 后端 validate 是唯一权威,本模块只放类型、默认值与不依赖外部输入的派生。
 * 解析(parse/normalize)与本地重判在 filter-conditions-parse.ts / filter-conditions-local.ts,
 * 校验在 filter-validate.ts,条件组模型与归一在 filter-groups.ts —— 本文件只做类型与门面。
 *
 * 条件组(设计 2026-10-06 §5):`groups` + `groupOp` 是唯一权威形态;下面 7 个平铺字段
 * 是**旧库回读兼容位**,`normalizeGroups` 会把它们搬进 `groups[0]` 并清空,写侧不再写。
 */
import { normalizeGroups } from './filter-groups';
import type { FilterGroup, GroupItem, GroupOp } from './filter-groups';

export {
  addGroup,
  addGroupItem,
  allItems,
  flatItemsOf,
  hasGroups,
  isBlankItem,
  itemPaths,
  mapGroupItems,
  migrateFlat,
  normalizeGroups,
  opOf,
  removeGroup,
  removeGroupItem,
  removePathItems,
  setGlobalGroupOp,
  setGroupOp,
  uiGroups,
} from './filter-groups';
export type { FilterGroup, GroupItem, GroupOp } from './filter-groups';
export {
  MAX_EXPR_CHARS,
  MAX_FILTER_KEYWORD_CHARS,
  MAX_FILTER_TAG_ITEMS,
  MAX_SORT_CONDS,
  isValidTagPath,
  validateFilter,
} from './filter-validate';

export interface TagCond {
  /** 标签完整路径(树语义真源) */
  path: string;
  /** 含子级:按路径前缀匹配自身与全部子孙;为假时仅精确本级 */
  includeChildren: boolean;
}

/** 关系条件(原「类型条件」,设计 2026-10-06 §10 R10b):只有被指向标签的路径 ——
 *  关系天然含子级并叠加继承,无「仅本级」开关 */
export interface RelationCond {
  path: string;
}

/** 排序方向:desc = 新 -> 旧 / 选项顺序;asc = 旧 -> 新 / 选项倒序(需按维度出文案) */
export type SortDir = 'desc' | 'asc';

/** 分组条件(设计 2026-10-06 §6):轴(任意标签路径)+ 组间方向。
 *  组键 = 轴下**一级子标签**(多值取树序第一,无该标签的笔记恒最后一组);
 *  `asc` = 选项顺序(树序),`desc` = 选项倒序。 */
export interface GroupByCond {
  path: string;
  dir: SortDir;
}

/** 排序条件(有序数组元素,下标即优先级):时间(notes.id)或标签轴子树(恒含子级) */
export type SortCond =
  | { kind: 'time'; dir: SortDir; enabled: boolean }
  | { kind: 'tag'; path: string; dir: SortDir; enabled: boolean };

export interface FilterConditions {
  /** 旧平铺字段(只读兼容位):归一后恒为空,条件一律住 `groups` */
  keyword: string | null;
  tags: TagCond[];
  excludeTags: TagCond[];
  /** 关系条件(原「类型条件」):命中 = 指向该标签的标签子树 ∪ 经携带/关系继承命中 */
  relations: RelationCond[];
  excludeRelations: RelationCond[];
  tagPresence: 'any' | 'none' | null;
  /** 创建顺序(实现为按 `notes.id`);**只读兼容位** —— 写侧由 `sorts` 派生镜像 */
  sort: 'newest' | 'oldest';
  /** 有序排序条件(下标 = 优先级;空数组 = 默认时间降序);旧 JSON 缺字段时由 `sort` 合成 */
  sorts: SortCond[];
  /** 分组条件(null = 不分组);落点与 `sorts` 同键(filter_current)。分组**不算收窄条件** */
  groupBy: GroupByCond | null;
  /** 高级表达式原文(spec 3.3;null=无表达式);归一到 groups 里的 expr 项 */
  expr: string | null;
  /** 组间关系(默认 'and';组内关系每组一个 `FilterGroup.op`) */
  groupOp: GroupOp;
  /** 条件组(空数组 = 没有条件组) */
  groups: FilterGroup[];
}

/** 默认条件:全部笔记,最新在前 */
export const EMPTY_FILTER: FilterConditions = {
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
};

/**
 * 旧单值 `sort` 折算成排序数组:仅 `oldest` 携带信息(合成一条时间升序),
 * `newest` 是默认值 -> 空数组(空数组经 `effective_sorts` 语义等价于时间降序)。
 * 两侧(归一/写侧 UI 兼容位)共用,杜绝两套合成口径。
 */
export function sortsFromLegacy(sort: 'newest' | 'oldest' | null | undefined): SortCond[] {
  return sort === 'oldest' ? [{ kind: 'time', dir: 'asc', enabled: true }] : [];
}

/**
 * 衍生旧镜像(只用于降级读取与命令勾选态,不参与 `filterKey`):
 * 第一条**启用的时间条件**方向定 `sort`,没有则 `newest`(标签条件不影响它)。
 */
export function sortMirror(sorts: SortCond[]): 'newest' | 'oldest' {
  const first = sorts.find((s) => s.enabled && s.kind === 'time');
  return first !== undefined && first.kind === 'time' && first.dir === 'asc' ? 'oldest' : 'newest';
}

/** 表达式是否为空(全空白视为没有表达式,与后端 trim 口径一致) */
export function hasExpr(c: FilterConditions): boolean {
  return normalizeGroups(c).groups.some((g) => g.items.some((it) => it.kind === 'expr'));
}

/** 是否"没有收窄条件"(排序不算收窄):空条件时筛选栏隐藏芯片区 */
export function isFilterEmpty(c: FilterConditions): boolean {
  return normalizeGroups(c).groups.length === 0;
}

/** 组内单项的值等价键(filterKey 用) */
function itemKey(it: GroupItem): unknown {
  switch (it.kind) {
    case 'tag':
    case 'excludeTag':
      return [it.kind, it.path, it.includeChildren];
    case 'relation':
    case 'excludeRelation':
      return [it.kind, it.path];
    case 'expr':
      // 表达式按 trim 后的值参与比较:尾随空白不触发重复查询(后端按原文解析,全空白视为未设置)
      return [it.kind, it.value.trim()];
    default:
      return [it.kind, it.value];
  }
}

/** 值等价键:用于 React 依赖比较(对象引用变化但值相同时不重复查询) */
export function filterKey(c: FilterConditions): string {
  const n = normalizeGroups(c);
  return JSON.stringify([
    n.groupOp,
    n.groups.map((g) => [g.op, g.items.map(itemKey)]),
    // 排序只认 sorts(旧 sort 是写侧派生镜像,不参与比较);enabled 停用项也要参与,
    // 否则勾掉/勾回不触发重查
    n.sorts.map((s) =>
      s.kind === 'tag' ? ['tag', s.path, s.dir, s.enabled] : ['time', s.dir, s.enabled]
    ),
    // 分组轴/方向变化必须重查(值变才重查的唯一判据就是这里)
    n.groupBy === null ? null : [n.groupBy.path, n.groupBy.dir],
  ]);
}
