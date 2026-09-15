/**
 * 就地变更后的本地重判(从 filter-conditions.ts 拆出,纯搬移):
 * 只有条件足够窄(仅"仅本级"引入标签)时才敢不重查后端,见 use-note-actions 的决策 G5。
 */
import type { FilterConditions } from './filter-conditions';

/** 就地变更后能否本地重判:仅"引入标签全为仅本级且无排除/日期/有无标签"时成立 */
export function canEvaluateLocally(c: FilterConditions): boolean {
  return (
    c.excludeTags.length === 0 &&
    c.tagPresence === null &&
    c.from === null &&
    c.to === null &&
    c.tags.every((t) => !t.includeChildren)
  );
}

/** 本地重判:笔记是否仍满足全部"仅本级"引入标签(AND) */
export function matchesTagsByPath(note: { tags: string[] }, c: FilterConditions): boolean {
  return c.tags.every((t) => note.tags.includes(t.path));
}
