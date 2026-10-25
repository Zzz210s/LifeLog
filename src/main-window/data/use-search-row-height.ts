/**
 * 「快捷搜索栏行高」的读写(设置键 `ui.search_row_height`)。
 * 与侧栏状态同一套路:挂载时读一次、写库后本地立即生效(不靠广播回环),
 * 读失败退回默认值 36(见 shared/search-row-height 的口径)。
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import {
  SEARCH_ROW_HEIGHT_DEFAULT,
  SEARCH_ROW_HEIGHT_KEY,
  normalizeSearchRowHeight,
} from '../../shared/search-row-height';

export interface SearchRowHeightApi {
  /** 当前行高(CSS px),恒在 28–56 且按 2 对齐 */
  height: number;
  /** 采纳新值:先本地生效再写库;写库失败回退到旧值(不留"界面变了库没变"的分裂) */
  setHeight: (n: number) => void;
  /** 恢复默认(设置页「恢复本分区默认」用) */
  reset: () => void;
}

export function useSearchRowHeight(): SearchRowHeightApi {
  const [height, setLocal] = useState(SEARCH_ROW_HEIGHT_DEFAULT);

  useEffect(() => {
    let alive = true;
    try {
      void api
        .getSetting(SEARCH_ROW_HEIGHT_KEY)
        .then((raw) => {
          if (!alive || raw === null || raw === '') return;
          setLocal(normalizeSearchRowHeight(raw));
        })
        .catch(() => {
          // 读不到就用默认值:这是纯外观项,不值得弹错误条
        });
    } catch {
      // 夹具里 api 可能只 mock 了部分方法(没有 getSetting):同步抛也要吞掉,
      // 否则一个纯外观设置会把整棵侧栏/输入栏带崩
    }
    return () => {
      alive = false;
    };
  }, []);

  const commit = useCallback((next: number) => {
    setLocal((prev) => {
      const n = normalizeSearchRowHeight(next);
      if (n === prev) return prev;
      void api.setSetting(SEARCH_ROW_HEIGHT_KEY, String(n)).catch(() => {
        setLocal(prev); // 写库失败:退回上一值,不给用户"调了但下次打开又回去"的错觉
      });
      return n;
    });
  }, []);

  const setHeight = useCallback((n: number) => commit(n), [commit]);
  const reset = useCallback(() => commit(SEARCH_ROW_HEIGHT_DEFAULT), [commit]);

  return { height, setHeight, reset };
}
