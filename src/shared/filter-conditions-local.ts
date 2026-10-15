/**
 * 就地变更后的本地重判(从 filter-conditions.ts 拆出,纯搬移;2026-10-06 条件组化):
 * 只有条件足够窄(单组、全 AND、"仅本级"引入标签)时才敢不重查后端,见 use-note-actions 的决策 G5。
 */
import { normalizeGroups } from './filter-conditions';
import type { FilterConditions } from './filter-conditions';
import type { NoteTag } from './types';

/** 就地变更后能否本地重判:组间 AND、每组组内 AND、且项全是"仅本级"引入标签。
 *  表达式 / 关系 / 有无标签 / 排除项都是后端语义(前端不做第二套解析/继承),有一律重查。 */
export function canEvaluateLocally(c: FilterConditions): boolean {
  const n = normalizeGroups(c);
  if (n.groupOp === 'or') return false;
  return n.groups.every(
    (g) => g.op === 'and' && g.items.every((it) => it.kind === 'tag' && !it.includeChildren)
  );
}

/** 本地重判:笔记是否仍满足全部"仅本级"引入标签(AND)。
 *  命中只看**路径**(设计 §5.2):关系名不参与 —— 名字是显示/回写用的,不是筛选语义。 */
export function matchesTagsByPath(note: { tags: NoteTag[] }, c: FilterConditions): boolean {
  return normalizeGroups(c).groups.every((g) =>
    g.items.every((it) => it.kind === 'tag' && note.tags.some((t) => t.path === it.path))
  );
}
