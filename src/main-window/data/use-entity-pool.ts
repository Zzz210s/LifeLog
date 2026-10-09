/**
 * `#` 与 `[[ ]]` 两套补全共用的**唯一实体池**(计划 T3.2,会话内缓存):
 * `complete_notes` 给全部实体的显示首行(`meta` 首行),`list_tags` 给树内实体(渲染闭包)的路径,
 * 合并成 `EntityCandidate[]` —— 树内实体 `path` 非空,树外为 null。
 *
 * 取数与失效口径沿用原 `useNoteTitles`:首次取全池,之后只在 `dataVersion` 变化或收到跨窗
 * `note-created` 时重取 —— 不每击键打 IPC。`enabled=false` 时整段不取(懒取):
 * 不用补全的会话一次 IPC 都不打。
 *
 * 跨窗失效(输入栏是独立 webview,拿不到主窗的 `dataVersion`):订阅既有 `note-created` ——
 * Rust 在 `save_input_note`/`update_note`/`delete_note` 落库后发出。订阅失败/无 Tauri 运行时
 * 静默降级(只剩 `dataVersion` 失效),不崩。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../../shared/api';
import { isInTree, mergeEntityPool } from '../../shared/entity-pool';
import type { EntityCandidate } from '../../shared/entity-pool';

/** 跨窗「笔记变化」事件名(与 Rust `commands/notes.rs` 的 NOTE_CREATED_EVENT 同值) */
export const NOTE_CREATED_EVENT = 'note-created';

export interface EntityPoolApi {
  /** 全部实体池(树内 + 树外),id 升序 */
  pool: readonly EntityCandidate[];
  /** 树内实体池(闭包)= `pool` 里 `path` 非空的子集 */
  tree: readonly EntityCandidate[];
  /** 池是否已就绪(拿到过一次成功结果);失败或尚未取回时为 false */
  ready: boolean;
}

export function useEntityPool(dataVersion: number, enabled = true): EntityPoolApi {
  const [pool, setPool] = useState<readonly EntityCandidate[]>([]);
  const [ready, setReady] = useState(false);
  // 跨窗事件计数:收到一次即作废会话缓存,与 dataVersion 一起构成重取键
  const [tick, setTick] = useState(0);
  // 首次(null)必取;之后同键不重取、换键取一次
  const seen = useRef<string | null>(null);

  // 订阅跨窗事件:失败静默(仅剩 dataVersion 失效);卸载即退订,迟到事件不再重取
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen(NOTE_CREATED_EVENT, () => setTick((t) => t + 1))
      .then((un) => {
        if (cancelled) un();
        else dispose = un;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const key = `${dataVersion}:${tick}`;
    if (seen.current === key) return;
    seen.current = key;
    let alive = true;
    void Promise.all([api.completeNotes(), api.listTags()]).then(
      ([titles, rows]) => {
        if (!alive) return;
        setPool(mergeEntityPool(titles, rows));
        setReady(true);
      },
      () => {
        if (!alive) return;
        setPool([]);
        setReady(false);
      }
    );
    return () => {
      alive = false;
    };
  }, [dataVersion, enabled, tick]);

  const tree = useMemo(() => pool.filter(isInTree), [pool]);
  return { pool, tree, ready };
}
