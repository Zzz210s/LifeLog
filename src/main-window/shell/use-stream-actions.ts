/**
 * 信息流的三条命令式动作(自 App 抽出以守行数红线):都是"点一下要发生什么"的接线,
 * 不持有状态 —— App 只把稳定的 setter 与数据层出口递进来。
 */
import { useCallback } from 'react';
import { api } from '../../shared/api';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { notifyTagsChanged } from '../data/tags-changed';
import type { ErrorKind } from './ErrorBar';

export interface StreamActionOptions {
  /** 回第一页(append=false);就地变更走 replaceNote,不重置分页与滚动位置 */
  fetchPage: (offset: number, append: boolean) => void;
  patch: (value: Partial<FilterConditions>) => void;
  /** 退编辑态(条件变化与新笔记到达都要退;传 useState 的 setter 保持身份稳定) */
  resetEditing: (id: number | null) => void;
  setError: (kind: ErrorKind, message: string) => void;
}

export interface StreamActions {
  /** 新内容必在最前:退编辑 + 回第一页 + 通知标签重载 */
  refresh: () => void;
  /** 空库引导:显示(不切换)输入栏;失败走既有错误条 */
  showInput: () => void;
  /** 空库引导:清空当前筛选的全部条件(排序也回默认) */
  clearFilters: () => void;
}

export function useStreamActions(o: StreamActionOptions): StreamActions {
  const { fetchPage, patch, resetEditing, setError } = o;

  const refresh = useCallback(() => {
    resetEditing(null);
    void fetchPage(0, false);
    notifyTagsChanged(); // 标签走唯一出口(与写库出口的重复通知合并成一次)
  }, [resetEditing, fetchPage]);

  const showInput = useCallback(() => {
    void api.showInputWindow().catch((e) => setError('action', '唤起输入栏失败: ' + String(e)));
  }, [setError]);

  const clearFilters = useCallback(() => patch(EMPTY_FILTER), [patch]);

  return { refresh, showInput, clearFilters };
}
