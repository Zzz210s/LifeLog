/**
 * 实体候选池(计划 T3.2):`#` / `@` / 默认档共用的**唯一池**,会话内按数据版本缓存。
 * 两路 IPC 与输入栏补全同源:`complete_notes`(全部实体的显示首行)+ `list_tags`(树内实体路径),
 * 合并逻辑在 `shared/entity-pool`(纯函数,两侧共用)。
 *
 * 缓存键 = 数据版本(主窗 `loadTags` 成功时递增):标签增删改、笔记保存后都会走一次,
 * 所以版本一变,下一次取候选就重打库,不会看到陈旧实体。失败不缓存(否则一次 IPC 抖动
 * 会把整个版本内的候选卡在同一个错误上),错误原样交给调用方。
 */
import { mergeEntityPool } from '../../shared/entity-pool';
import type { EntityCandidate } from '../../shared/entity-pool';
import type { NoteTitle, TagCount } from '../../shared/types';

export interface EntityCandidates {
  /** 取实体池:版本未变直接复用缓存;版本变了(或上次失败)才重打库 */
  current(version: number): Promise<readonly EntityCandidate[]>;
}

export function createEntityCandidates(
  fetchTitles: () => Promise<readonly NoteTitle[]>,
  fetchTree: () => Promise<readonly TagCount[]>,
  /** 顺带把树内行交给调用方(标签装饰用),不额外再打一次 IPC */
  onTree?: (rows: readonly TagCount[]) => void,
): EntityCandidates {
  let version = -1;
  let cache: Promise<readonly EntityCandidate[]> | null = null;
  return {
    current: (v: number) => {
      if (cache !== null && v === version) return cache;
      version = v;
      const pending = Promise.all([fetchTitles(), fetchTree()]).then(([titles, tree]) => {
        onTree?.(tree);
        return mergeEntityPool(titles, tree);
      });
      cache = pending;
      void pending.catch(() => {
        if (cache === pending) cache = null;
      });
      return pending;
    },
  };
}
