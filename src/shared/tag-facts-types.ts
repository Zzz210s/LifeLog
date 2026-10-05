// 标签类型的批量读 / 命中数读数类型(自 shared/types.ts 抽出,守 200 行上限)。
// camelCase 与 Rust TagFact / TagFactsBundle / ConditionHits 一致。
import type { TypeRef } from './types';

/** 单个标签的「类型 / 携带」事实(IPC `list_tag_facts`):
 *  types = 该标签认领的类型;carried = 该标签携带的目标标签路径(前端拿 bundle.types 换算成类型与值) */
export interface TagFact {
  tagId: number;
  types: TypeRef[];
  carried: string[];
}

/** 批量事实包(IPC `list_tag_facts`):types 是完整类型表,与 facts 一起给,一次 IPC 取全 */
export interface TagFactsBundle {
  types: TypeRef[];
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
