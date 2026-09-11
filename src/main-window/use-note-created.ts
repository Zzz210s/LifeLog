import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { shouldAutoRefresh } from './notes-list';

/**
 * 订阅后端 note-created(快捷窗保存成功):满足 shouldAutoRefresh 时自动刷新主窗列表。
 * 用 ref 读取最新的列表长度与编辑态,订阅只注册一次;卸载时取消(含 listen 未 resolve 的竞态)。
 */
export function useNoteCreatedRefresh(
  noteCount: number,
  editingId: number | null,
  onRefresh: () => void
): void {
  const latest = useRef({ noteCount, editingId, onRefresh });
  latest.current = { noteCount, editingId, onRefresh };

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen('note-created', () => {
      const s = latest.current;
      if (shouldAutoRefresh(s.noteCount, s.editingId)) s.onRefresh();
    }).then((un) => {
      if (cancelled) un();
      else dispose = un;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);
}
