// 标签关系线(RelationRef)与批量读 / 命中数读数类型(自 shared/types.ts 抽出,守 200 行上限)。
// camelCase 与 Rust RelationRef / TagFact / TagFactsBundle / ConditionHits 一致。

/** 一条标签关系线(IPC `list_tag_relations` / `list_tag_facts`):
 *  读作「被引用点 `toTagId` 上有一条名为 `nameText` 的线」(`A --(国籍)--> B` 的 `国籍`)。
 *  v31 起名字存在**点**上:`nameId` 是名字点 id(null = 无名字线),`nameText` 是名字点文本
 *  (无名字线为空串,显示时回退只给被引用点名)。 */
export interface RelationRef {
  toTagId: number;
  path: string;
  name: string;
  /** 名字点 id(`lines.name_id`;null / 缺省 = 无名字线) */
  nameId?: number | null;
  /** 名字点文本(无名字线为空串):显示口径的数据源 */
  nameText?: string;
  /** 线 id(`lines.id`):删某一条具体的线用。后端 DTO 尚未输出,先占位 */
  lineId?: number;
  /** @deprecated v30 的「边上的属性名」;v31 后端已不再输出,读取请用 `nameText`(T4.2/T4.3 后删除) */
  remark?: string;
}

/** 单个标签的关系事实(IPC `list_tag_facts`):relations = 该标签的全部出边(A -> ?) */
export interface TagFact {
  /** 标签实体 id(统一实体表;与 `RelationRef.toTagId` 同一命名空间) */
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
