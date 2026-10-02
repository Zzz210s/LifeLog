/**
 * `[[` 补全的候选池(会话内缓存,设计 N9):首次取全池,之后只在 `dataVersion` 变化
 * 或收到跨窗「笔记变化」事件时重取 —— 不每击键打 IPC。版本号是主窗既有那份(`App` 的
 * `tagsVersion`,写库/输入栏事件驱动递增)。
 *
 * 跨窗失效(输入栏是独立 webview,拿不到主窗的 `dataVersion`):订阅既有的 `note-created` ——
 * Rust 在 `save_input_note`/`update_note`/`delete_note` 落库后发出,输入栏目录里改名/删笔记
 * 不必重进会话就能刷新。订阅失败/无 Tauri 运行时时静默降级(只剩 `dataVersion` 失效),不崩。
 *
 * `enabled=false` 时整段不取(懒取):`[[` 补全只在真的出现未闭合括号后才拉一次池,
 * 不用这个功能的会话一次 IPC 都不打。`enabled` 由假转真时按当时版本取一次。
 */
import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../../shared/api';
import type { NoteTitle } from '../../shared/types';

/** 跨窗「笔记变化」事件名(与 Rust `commands/notes.rs` 的 NOTE_CREATED_EVENT 同值) */
export const NOTE_CREATED_EVENT = 'note-created';

export interface NoteTitlesApi {
  titles: readonly NoteTitle[];
  /** 池是否已就绪(拿到过一次成功结果);失败或尚未取回时为 false */
  ready: boolean;
}

export function useNoteTitles(dataVersion: number, enabled = true): NoteTitlesApi {
  const [titles, setTitles] = useState<NoteTitle[]>([]);
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
  }, [dataVersion, enabled, tick]);
  return { titles, ready };
}
