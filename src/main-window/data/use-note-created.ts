import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { shouldAutoRefresh } from '../stream/notes-list';
import { notifyTagsChanged } from './tags-changed';

/**
 * 订阅后端 note-created(输入栏/统一输入框保存成功):
 * - **标签新鲜度无条件通知**(T6 修复轮 I2):保存可能带来新标签,而标签通知与"列表是否自动刷新"
 *   是两件事 —— 已翻页/编辑中时只该跳过回首页重查,绝不能连标签一起跳过(否则浮层 `#` 陈旧无上界);
 * - 满足 shouldAutoRefresh 时额外回首页重查。
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
      notifyTagsChanged(); // 标签新鲜度与列表刷新解耦:这条绝不跳过
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
