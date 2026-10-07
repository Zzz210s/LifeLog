// 标签关系的批量读 / 命中数读数类型(自 shared/types.ts 抽出,守 200 行上限)。
// camelCase 与 Rust TagFact / TagFactsBundle / ConditionHits 一致。
import type { RelationRef } from './types';

/** 单个标签的关系事实(IPC `list_tag_facts`):relations = 该标签的全部出边(A -> ?) */
export interface TagFact {
  tagId: number;
  relations: RelationRef[];
}

/** 批量事实包(IPC `list_tag_facts`):一次 IPC 取全 */
export interface TagFactsBundle {
  facts: TagFact[];
}

/** 条件栏「命中 N 条」读数(IPC `condition_hit_counts`):**按组 / 按项**同序。
 *  AND 组给逐项独立读数(每项只算自己的命中集,不叠加其它条件);
 *  OR 组的逐项读数会产生误导(设计 §5.4),故 `itemHits` 为空,只给 `groupHit`(整组谓词 COUNT)。 */
export interface GroupHits {
  op: 'and' | 'or';
  /** 与组内 items 同序;仅 op==='and' 有意义(OR 组为空数组) */
  itemHits: number[];
  /** 整组命中数(OR 组必给;AND 组为 null,不白跑一次 COUNT) */
  groupHit: number | null;
}

/** 条件栏读数:每个条件组一条,顺序与条件对象 `groups` 一致 */
export interface ConditionHits {
  groups: GroupHits[];
}
