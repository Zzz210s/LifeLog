import { invoke } from '@tauri-apps/api/core';
import type { DbInfo, Note } from './types';

export const api = {
  saveInputNote: (content: string) => invoke<Note>('save_input_note', { content }),
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
  hideInputBar: () => invoke<void>('hide_input_bar'),
  /** 缩放:窗口尺寸 = 基础尺寸 x 系数,并落到 webview zoom */
  setInputScale: (zoom: number) => invoke<void>('set_input_scale', { zoom }),
  setInputSize: (width: number, height: number) =>
    invoke<void>('set_input_size', { width, height }),
  /** 三档锁定一次事务写库 */
  setInputLocks: (lockMove: boolean, lockClose: boolean, lockContent: boolean) =>
    invoke<void>('set_input_locks', { lockMove, lockClose, lockContent }),
  getSetting: (key: string) => invoke<string | null>('get_setting', { key }),
  setSetting: (key: string, value: string) => invoke<void>('set_setting', { key, value }),
  /** 设置页「通用」分区:数据库文件路径与笔记条数(只读) */
  getDbInfo: () => invoke<DbInfo>('get_db_info'),
  /** 设置页「启动」分区:注册表里的真实开机启动状态(只读;path_ok=false 表示路径已失效)。
   *  字段名与 Rust 结构体一致(snake_case 直传,见 shared/types.ts 的惯例) */
  getAutostartStatus: () => invoke<{ enabled: boolean; path_ok: boolean }>('get_autostart_status'),
  /** 实际注册/取消开机启动;Rust 侧写后回读校验,不一致会 reject */
  setAutostart: (enabled: boolean) => invoke<void>('set_autostart', { enabled }),
};
