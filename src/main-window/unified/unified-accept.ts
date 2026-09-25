/**
 * 采纳副作用(设计 2026-09-24 §4 表;计划 Task 6)。
 *
 * 只做**决策**:`effectFor` 是纯函数,把 (模式, 候选行, 当前条件) 映射成一句可执行的描述;
 * 真正的动作(滚到笔记 / 打条件补丁 / 跑命令)由容器 `StreamView` 执行 —— 决策可单测,
 * 副作用不藏在纯函数里。
 *
 * `#` 的补丁走 `applyTagPick`(与侧栏点标签同一套去重规则):已在条件里的同名标签原样返回,
 * 此时给 `none`。与侧栏的区别是**意图不同**:侧栏那一下是“开/关这个标签”(已选则取消),
 * 输入框这一下是“把候选采纳成条件”(已经在了就不必再动),所以这里不做 toggle off。
 *
 * 跨侧去重(修复轮):同一路径已在**排除侧**时,采纳的语义是"移到包含侧" —— 结果恒 0 条的
 * 条件(⊢ #X 与 排除 #X 并存)没有任何意义,仓库不变量见 sidebar/tag-tree.ts::toggleTagPick。
 * 这种补丁必须**两侧都给**:容器只 patch `tags` 的话,排除项会留在原地。
 */
import type { FilterConditions } from '../../shared/filter-conditions';
import type { InputMode } from '../../shared/input-prefix';
import type { ListRow } from '../../shared/quickpick/model';
import { applyTagPick } from '../filter/filter-chips';

export type AcceptEffect =
  | { kind: 'scroll-to-note'; id: number }
  | { kind: 'filter-patch'; patch: Partial<FilterConditions> }
  | { kind: 'run-command'; id: string }
  | { kind: 'none' };

/**
 * 采纳行的最小输入:下拉给的是列表模型的行(id 在 `item.id`),
 * 设计向量的写法是裸行(顶层 id)—— 两种形状都认,不必为了喂这个纯函数再造一层包装。
 */
export type AcceptRow = ListRow | { readonly id: string };

/** 行 id(两个形状的唯一差别就在这一处) */
function rowId(row: AcceptRow): string {
  return 'item' in row ? row.item.id : row.id;
}

/** 采纳一行 -> 副作用描述(纯函数:不读 DOM、不跑命令、不写库) */
export function effectFor(mode: InputMode, row: AcceptRow, conditions: FilterConditions): AcceptEffect {
  const id = rowId(row);
  if (mode === 'open') return { kind: 'scroll-to-note', id: Number(id) };
  if (mode === 'command') return { kind: 'run-command', id };
  if (mode !== 'tag') return { kind: 'none' }; // 记录模式 / 实时筛选模式没有采纳副作用
  const next = applyTagPick(conditions, id, { exclude: false, includeChildren: true });
  // 排除侧已有同一路径:这次采纳把它移到包含侧(补丁两侧都给,见文件头)
  const excluded = conditions.excludeTags.some((t) => t.path === id);
  if (next === conditions && !excluded) return { kind: 'none' }; // 该标签已在包含侧(同侧去重的引用相等出口)
  return {
    kind: 'filter-patch',
    patch: {
      tags: next.tags,
      excludeTags: excluded ? conditions.excludeTags.filter((t) => t.path !== id) : conditions.excludeTags,
    },
  };
}
