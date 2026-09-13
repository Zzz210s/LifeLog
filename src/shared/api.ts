import { invoke } from '@tauri-apps/api/core';
import type { DbInfo, Note, SavedView, TagCount, TagImpact } from './types';
import type { FilterConditions } from './filter-conditions';

export const api = {
  saveInputNote: (content: string) => invoke<Note>('save_input_note', { content }),
  /** 条件对象查询:offset 为行偏移,页大小由后端固定(前端 PAGE 与之一致) */
  queryNotes: (conditions: FilterConditions, offset: number) =>
    invoke<Note[]>('query_notes', { conditions, offset }),
  tagCounts: () => invoke<[string, number][]>('tag_counts'),
  /** 标签树全量计数(完整路径);标签面板与树形选择器数据源 */
  listTags: () => invoke<TagCount[]>('list_tags'),
  /** 改标签名(单段);级联重写子树路径与全文索引 */
  renameTag: (tagId: number, newName: string) =>
    invoke<void>('rename_tag', { tagId, newName }),
  /** 移动标签;newParentId=null 移到根级 */
  moveTag: (tagId: number, newParentId: number | null) =>
    invoke<void>('move_tag', { tagId, newParentId }),
  /** 删除标签子树(删前先用 tagImpact 二次确认) */
  deleteTag: (tagId: number) => invoke<void>('delete_tag', { tagId }),
  /** 删除前影响面:将影响的子孙标签数与笔记数 */
  tagImpact: (tagId: number) => invoke<TagImpact>('tag_impact', { tagId }),
  /** 输入栏补全:按路径前缀列出候选 */
  completeTags: (prefix: string) => invoke<string[]>('complete_tags', { prefix }),
  /** 视图命令(MVP-3):自建视图 CRUD 与排序;内置视图是前端常量不经命令 */
  listViews: () => invoke<SavedView[]>('list_views'),
  createView: (title: string, conditions: FilterConditions) =>
    invoke<number>('create_view', { title, conditions }),
  updateView: (id: number, title: string, conditions: FilterConditions) =>
    invoke<void>('update_view', { id, title, conditions }),
  deleteView: (id: number) => invoke<void>('delete_view', { id }),
  /** ids 须为全部自建视图的新顺序(整批重写排序) */
  reorderViews: (ids: number[]) => invoke<void>('reorder_views', { ids }),
  /** 命中计数:内置键 all/todo/untagged,自建键 view:<id>;供侧栏徽标 */
  countViewHits: () => invoke<[string, number][]>('count_view_hits'),
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
