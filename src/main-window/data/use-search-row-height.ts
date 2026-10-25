/**
 * 「快捷搜索栏行高」的读写(设置键 `ui.search_row_height`)。
 * 与侧栏状态同一套路:挂载时读一次、写库后本地立即生效(不靠广播回环),
 * 读失败退回默认值 36(见 shared/search-row-height 的口径)。
 */
import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../../shared/api';
import { INPUT_SETTINGS_CHANGED_EVENT } from '../../shared/input-settings';
import { notifyInputSettingsChanged } from '../settings/input-settings-events';
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

  // 读一次设置(挂载 + 收到「输入栏设置变了」通知时各跑一次)
  const read = useCallback((still: () => boolean) => {
    try {
      void api
        .getSetting(SEARCH_ROW_HEIGHT_KEY)
        .then((raw) => {
          if (!still()) return;
          // 空值 = 没存过 / 被清掉(「恢复默认」写的就是空串):回默认 36,
          // 不能"保持上一值" —— 否则清键之后界面停在旧读数上
          setLocal(raw === null || raw === '' ? SEARCH_ROW_HEIGHT_DEFAULT : normalizeSearchRowHeight(raw));
        })
        .catch(() => {
          // 读不到就用默认值:这是纯外观项,不值得弹错误条
        });
    } catch {
      // 夹具里 api 可能只 mock 了部分方法(没有 getSetting):同步抛也要吞掉,
      // 否则一个纯外观设置会把整棵侧栏/输入栏带崩
    }
  }, []);

  useEffect(() => {
    let alive = true;
    read(() => alive);
    // 设置页改完会广播 INPUT_SETTINGS_CHANGED_EVENT:输入栏那个窗口收不到主窗的 React 状态,
    // 只靠这件事通知它重读 —— 否则改了行高要等下一次唤起才生效(用户 2026-10-25 实测过)。
    const un = listen(INPUT_SETTINGS_CHANGED_EVENT, () => read(() => alive));
    return () => {
      alive = false;
      void un.then((fn) => fn()).catch(() => {});
    };
  }, [read]);

  const commit = useCallback((next: number) => {
    setLocal((prev) => {
      const n = normalizeSearchRowHeight(next);
      if (n === prev) return prev;
      void api
        .setSetting(SEARCH_ROW_HEIGHT_KEY, String(n))
        .then(() => notifyInputSettingsChanged()) // 输入栏那个窗口据此重读行高
        .catch(() => {
          setLocal(prev); // 写库失败:退回上一值,不给用户"调了但下次打开又回去"的错觉
        });
      return n;
    });
  }, []);

  const setHeight = useCallback((n: number) => commit(n), [commit]);
  const reset = useCallback(() => commit(SEARCH_ROW_HEIGHT_DEFAULT), [commit]);

  return { height, setHeight, reset };
}
