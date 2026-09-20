import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { shouldAutoRefresh } from '../stream/notes-list';

/**
 * 订阅后端 note-created(输入栏保存成功):满足 shouldAutoRefresh 时自动刷新主窗列表。
 * 用 ref 读取最新的列表长度与编辑态,订阅只注册一次;卸载时取消(含 listen 未 resolve 的竞态)。
 * 订阅失败(无 Tauri 运行时/权限缺失)会静默失去自动刷新,故必须经 onError 上报而非吞掉。
 */
export function useNoteCreatedRefresh(
  noteCount: number,
  editingId: number | null,
  onRefresh: () => void,
  onError?: (message: string) => void
): void {
  const latest = useRef({ noteCount, editingId, onRefresh, onError });
  latest.current = { noteCount, editingId, onRefresh, onError };

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen('note-created', () => {
      const s = latest.current;
      if (shouldAutoRefresh(s.noteCount, s.editingId)) s.onRefresh();
    })
      .then((un) => {
        if (cancelled) un();
        else dispose = un;
      })
      .catch((e) => {
        latest.current.onError?.('跨窗刷新订阅失败: ' + String(e));
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);
}
