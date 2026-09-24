/**
 * 采纳副作用(设计 2026-09-24 §4 表;计划 Task 6)。
 *
 * 只做**决策**:`effectFor` 是纯函数,把 (模式, 候选行, 当前条件) 映射成一句可执行的描述;
 * 真正的动作(滚到笔记 / 打条件补丁 / 跑命令)由容器 `StreamView` 执行 —— 决策可单测,
 * 副作用不藏在纯函数里。
 *
 * `#` 的补丁走 `applyTagPick`(与侧栏点标签同一套去重规则):已在条件里的同名标签原样返回,
 * 此时给 `none` —— 不能改成"再点一次就取消",那与侧栏的加标签语义不一致。
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
  // 引用相等即"这条标签已在条件里"(applyTagPick 的去重出口):原样返回,不产生空补丁
  return next === conditions ? { kind: 'none' } : { kind: 'filter-patch', patch: { tags: next.tags } };
}
