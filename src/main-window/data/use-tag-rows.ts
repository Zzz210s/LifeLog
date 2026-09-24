/**
 * 标签树数据 + 版本号(自 App 抽出以留出行数余量:App 还要接「添加条件」信号与条件栏 props)。
 *
 * - 版本号每次成功重载递增:浮层的 `#` 候选池据此作废(不每键一次全树查询)。
 * - 重载只由唯一出口 onTagsChanged 驱动(写库 / 输入栏事件 / 侧栏变更都只声明"可能变了")。
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import type { TagCount } from '../../shared/types';
import type { ErrorKind } from '../shell/ErrorBar';
import { onTagsChanged } from './tags-changed';

export interface TagRowsApi {
  tagRows: TagCount[];
  /** 标签数据版本(浮层 `#` 候选池的作废键) */
  tagsVersion: number;
}

export function useTagRows(
  setError: (kind: ErrorKind, message: string) => void,
  clearError: (kind: ErrorKind) => void
): TagRowsApi {
  const [tagRows, setTagRows] = useState<TagCount[]>([]);
  const [tagsVersion, setTagsVersion] = useState(0);

  const reloadTags = useCallback(() => {
    void api
      .listTags()
      .then((rows) => {
        setTagRows(rows);
        setTagsVersion((v) => v + 1);
        clearError('tags');
      })
      .catch((e) => setError('tags', '标签加载失败: ' + String(e)));
  }, [clearError, setError]);

  // 挂载先读一次;之后只由唯一出口驱动(订阅在卸载时退订)
  useEffect(() => {
    reloadTags();
    return onTagsChanged(reloadTags);
  }, [reloadTags]);

  return { tagRows, tagsVersion };
}
