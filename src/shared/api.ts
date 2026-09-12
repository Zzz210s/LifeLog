import { invoke } from '@tauri-apps/api/core';
import type { Note } from './types';

export const api = {
  saveQuickNote: (content: string) => invoke<Note>('save_quick_note', { content }),
  queryNotes: (p: {
    keyword?: string;
    tags: string[];
    offset: number;
    limit: number;
    oldestFirst: boolean;
  }) => invoke<Note[]>('query_notes', p),
  tagCounts: () => invoke<[string, number][]>('tag_counts'),
  updateNote: (id: number, content: string) =>
    invoke<Note | null>('update_note', { id, content }),
  toggleTodo: (id: number) => invoke<Note | null>('toggle_todo', { id }),
  deleteNote: (id: number) => invoke<void>('delete_note', { id }),
  exportNotes: (path: string) => invoke<void>('export_notes', { path }),
  hideQuickWindow: () => invoke<void>('hide_quick_window'),
  /** 缩放:窗口尺寸 = 基础尺寸 x 系数,并落到 webview zoom */
  setQuickScale: (zoom: number) => invoke<void>('set_quick_scale', { zoom }),
  setQuickSize: (width: number, height: number) =>
    invoke<void>('set_quick_size', { width, height }),
  /** 三档锁定一次事务写库 */
  setQuickLocks: (lockMove: boolean, lockClose: boolean, lockContent: boolean) =>
    invoke<void>('set_quick_locks', { lockMove, lockClose, lockContent }),
  getSetting: (key: string) => invoke<string | null>('get_setting', { key }),
  setSetting: (key: string, value: string) => invoke<void>('set_setting', { key, value }),
};
