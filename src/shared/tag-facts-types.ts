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

/** 条件栏「命中 N 条」读数(IPC `condition_hit_counts`):四组与条件对象里的四个数组同序,
 *  每个数只算该条件自己的命中集(不叠加其它条件) */
export interface ConditionHits {
  tagHits: number[];
  excludeTagHits: number[];
  typeHits: number[];
  excludeTypeHits: number[];
}
