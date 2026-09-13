/**
 * 视图命中读数(侧栏徽标数据源,Task 2 审查 Minor 的调用侧降级在此收口):
 * count_view_hits 失败时整体降级为空表 —— 每个徽标渲染「—」,而不是让整栏报错。
 */
import { api } from '../shared/api';

/** key 为内置键(all/todo/untagged)或自建视图键(view:<id>) */
export type ViewHits = Record<string, number>;

/**
 * 批量取视图命中数:失败返回空表(调用方按「查不到即 —」渲染),绝不向上抛错。
 */
export async function fetchViewHits(): Promise<ViewHits> {
  try {
    const rows = await api.countViewHits();
    const hits: ViewHits = {};
    for (const [key, n] of rows) hits[key] = n;
    return hits;
  } catch {
    return {};
  }
}
