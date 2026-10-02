/**
 * `[[` 补全的候选池(会话内缓存,设计 N9):首次取全池,之后只在 `dataVersion` 变化时重取 ——
 * 不每击键打 IPC。版本号是主窗既有那份(`App` 的 `tagsVersion`,写库/输入栏事件驱动递增)。
 * 失败退化为空池且 `ready` 保持 false,不抛:补全入口静默无候选,不打断输入。
 *
 * `enabled=false` 时整段不取(懒取):`[[` 补全只在真的出现未闭合括号后才拉一次池,
 * 不用这个功能的会话一次 IPC 都不打。`enabled` 由假转真时按当时版本取一次。
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import type { NoteTitle } from '../../shared/types';

export interface NoteTitlesApi {
  titles: readonly NoteTitle[];
  /** 池是否已就绪(拿到过一次成功结果);失败或尚未取回时为 false */
  ready: boolean;
}

export function useNoteTitles(dataVersion: number, enabled = true): NoteTitlesApi {
  const [titles, setTitles] = useState<NoteTitle[]>([]);
  const [ready, setReady] = useState(false);
  // 首次(null)必取;之后同版本不重取、换版本取一次
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (seen.current === dataVersion) return;
    seen.current = dataVersion;
    let alive = true;
    void api.completeNotes().then(
      (pool) => {
        if (!alive) return;
        setTitles(pool);
        setReady(true);
      },
      () => {
        if (!alive) return;
        setTitles([]);
        setReady(false);
      }
    );
    return () => {
      alive = false;
    };
  }, [dataVersion, enabled]);
  return { titles, ready };
}
