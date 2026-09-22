/**
 * 标签候选池(T6 复审 I1):`#` 模式原先每次按键都跑一次全树 `list_tags`
 * (762 标签 / 5992 链接的递归 CTE,真实库实测 ~12ms 且持全局 DB 锁)。
 * 这里照笔记路径的办法把整个数组缓存在会话内,缓存键 = 标签数据版本 —
 * 版本由主窗 `loadTags` 成功时递增(标签增删改、笔记保存后都会走一次),
 * 版本一变,下一次取候选就重打库,所以不会看到陈旧标签。
 */
import type { TagCount } from '../../shared/types';

export interface TagCandidates {
  /** 取标签候选:版本未变直接复用缓存;版本变了(或上次失败)才重打库 */
  current(version: number): Promise<readonly TagCount[]>;
}

export function createTagCandidates(
  fetchTags: () => Promise<readonly TagCount[]>,
): TagCandidates {
  let version = -1;
  let cache: Promise<readonly TagCount[]> | null = null;
  return {
    current: (v: number) => {
      if (cache !== null && v === version) return cache;
      version = v;
      const pending = fetchTags();
      cache = pending;
      // 失败不缓存:否则一次 IPC 抖动会把整个版本内的 `#` 模式卡在同一个错误上,
      // 用户只能等标签数据变更才能重试。错误仍原样交给调用方(浮层落错误条)。
      void pending.catch(() => {
        if (cache === pending) cache = null;
      });
      return pending;
    },
  };
}
