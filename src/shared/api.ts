import { invoke } from '@tauri-apps/api/core';
import type { CompleteItem, DbInfo, ExprCheck, MergeReport, Note, ParseResult, TagCount, TagImpact } from './types';
import type { FilterConditions } from './filter-conditions';
import type { AppHotkeyKind } from './hotkey-match';

export const api = {
  saveInputNote: (content: string) => invoke<Note>('save_input_note', { content }),
  /** 条件对象查询:offset 为行偏移,页大小由后端固定(前端 PAGE 与之一致) */
  queryNotes: (conditions: FilterConditions, offset: number) =>
    invoke<Note[]>('query_notes', { conditions, offset }),
  /** 实时校验表达式:合法给中文预览,非法给中文原因与 0 起出错字符下标 */
  validateExpr: (text: string) => invoke<ExprCheck>('validate_expr', { text }),
  /** 标签树全量计数(完整路径);标签面板与树形选择器数据源 */
  listTags: () => invoke<TagCount[]>('list_tags'),
  /** 改标签名(单段);级联重写子树路径与全文索引 */
  renameTag: (tagId: number, newName: string) =>
    invoke<void>('rename_tag', { tagId, newName }),
  /** 移动标签;newParentId=null 移到根级 */
  moveTag: (tagId: number, newParentId: number | null) =>
    invoke<void>('move_tag', { tagId, newParentId }),
  /** 同级插入(S8):移到 anchorId 所在层,插到其之前(after=false)/之后(after=true) */
  moveTagBeside: (tagId: number, anchorId: number, after: boolean) =>
    invoke<void>('move_tag_beside', { tagId, anchorId, after }),
  /** 删除标签子树(删前先用 tagImpact 二次确认) */
  deleteTag: (tagId: number) => invoke<void>('delete_tag', { tagId }),
  /** 删除前影响面:将影响的子孙标签数与笔记数 */
  tagImpact: (tagId: number) => invoke<TagImpact>('tag_impact', { tagId }),
  /** 该标签的全部别名(按 alias 升序) */
  listTagAliases: (tagId: number) => invoke<string[]>('list_tag_aliases', { tagId }),
  /** 登记别名:失败给中文原因(空 / 含空白 / 含 # / 与现有标签重名 / 目标标签不存在) */
  addTagAlias: (alias: string, tagId: number) => invoke<void>('add_tag_alias', { alias, tagId }),
  /** 删除别名(幂等:不存在也算成功) */
  removeTagAlias: (alias: string) => invoke<void>('remove_tag_alias', { alias }),
  /** 合并标签(G2 命令):转移链接 + 可选保留旧名为别名,返回转移读数 */
  mergeTags: (sourceId: number, targetId: number, keepAlias: boolean) =>
    invoke<MergeReport>('merge_tags', { sourceId, targetId, keepAlias }),
  /** 输入栏补全:按路径前缀列出候选(别名命中项的 kind=alias) */
  completeTags: (prefix: string) => invoke<CompleteItem[]>('complete_tags', { prefix }),
  /** 更新笔记:**标签集合整集合替换**为正文里的 #标签 —— 调用方必须自带该笔记的全部标签(UI 编辑框会回显),否则会丢标签 */
  updateNote: (id: number, content: string) =>
    invoke<Note | null>('update_note', { id, content }),
  deleteNote: (id: number) => invoke<void>('delete_note', { id }),
  /** 解析笔记源码 -> 保存后的正文 + 标签集合(与保存路径共用同一实现,解析的唯一真源);
   *  编辑面板用它实时显示标签数,前端不复制标签语法 */
  parseNoteSource: (source: string) => invoke<ParseResult>('parse_note_source', { source }),
  exportNotes: (path: string) => invoke<void>('export_notes', { path }),
  hideInputBar: () => invoke<void>('hide_input_bar'),
  /** 隐藏主窗(与标题栏 X、托盘同一语义;页面发起的 window.close() 走这条 —— 待办 #36) */
  hideMainWindow: () => invoke<void>('hide_main_window'),
  /** 显示主窗(输入栏首次启动放新手引导时调用;与托盘「打开主窗口」同一实现) */
  openMainWindow: () => invoke<void>('open_main_window'),
  /** 设置输入栏唤起快捷键:成功返回规范化后的生效值;失败返回中文原因且旧键仍可用 */
  setInputHotkey: (accelerator: string) => invoke<string>('set_input_hotkey', { accelerator }),
  /** 运行时实际生效的快捷键(null = 当前没有热键在生效);界面显示用它而非库值 */
  getInputHotkey: () => invoke<string | null>('get_input_hotkey'),
  /** 应用内快捷键(命令面板 / 快速打开笔记)的唯一写路径:经 Rust 规范化 + 冲突检查后落库,
   *  返回规范化值;accelerator 传空串 = 清除自定义(读取侧回退默认键)。
   *  失败给中文原因(语法非法 / 与系统级键冲突 / 与另一个应用内键冲突)且旧键保持可用 */
  setAppHotkey: (kind: AppHotkeyKind, accelerator: string) =>
    invoke<string>('set_app_hotkey', { kind, accelerator }),
  /** 显示(不切换)输入栏:主窗空库引导用 */
  showInputWindow: () => invoke<void>('show_input_bar'),
  /** 取一次「迁移前自动备份失败」提示(取值即清空;无提示时返回 null) */
  takeBackupWarning: () => invoke<string | null>('take_backup_warning'),
  /** 主窗 mount 时取用「打开后切到设置页」意图(取走即清空;窗口是本次新建时事件会丢) */
  takePendingOpenSettings: () => invoke<boolean>('take_pending_open_settings'),
  /** 缩放:窗口尺寸 = 基础尺寸 x 系数,并落到 webview zoom */
  setInputScale: (zoom: number) => invoke<void>('set_input_scale', { zoom }),
  /** 宽度拖动路径(唯一会写 input_w 的命令):width = 当前逻辑像素意图,height = 基础逻辑像素 */
  setInputSize: (width: number, height: number) =>
    invoke<void>('set_input_size', { width, height }),
  /** 自动高度:height 是**基础**逻辑像素(缩放无关);宽度原样保留,绝不改写 input_w */
  setInputHeight: (height: number) => invoke<void>('set_input_height', { height }),
  /** 带建议列表时的高度:同上但不写库(展开高度不落 input_h) */
  setInputHeightOverlay: (height: number) =>
    invoke<void>('set_input_height_overlay', { height }),
  /** 三档锁定一次事务写库 */
  setInputLocks: (lockMove: boolean, lockClose: boolean, lockContent: boolean) =>
    invoke<void>('set_input_locks', { lockMove, lockClose, lockContent }),
  getSetting: (key: string) => invoke<string | null>('get_setting', { key }),
  setSetting: (key: string, value: string) => invoke<void>('set_setting', { key, value }),
  /** 设置页「笔记」分区:时间标签模板即时校验(合法 resolve,非法 reject 中文原因) */
  validateTimeTagTemplate: (template: string) =>
    invoke<void>('validate_time_tag_template', { template }),
  /** 设置页「通用」分区:数据库文件路径与笔记条数(只读) */
  getDbInfo: () => invoke<DbInfo>('get_db_info'),
  /** 设置页「启动」分区:注册表里的真实开机启动状态(只读;path_ok=false 表示路径已失效)。
   *  字段名与 Rust 结构体一致(snake_case 直传,见 shared/types.ts 的惯例) */
  getAutostartStatus: () => invoke<{ enabled: boolean; path_ok: boolean }>('get_autostart_status'),
  /** 实际注册/取消开机启动;Rust 侧写后回读校验,不一致会 reject */
  setAutostart: (enabled: boolean) => invoke<void>('set_autostart', { enabled }),
  /** 命令面板「重建搜索索引」:幂等整体重建 FTS,返回写入的索引行数 */
  rebuildSearchIndex: () => invoke<number>('rebuild_search_index'),
  /** 命令面板「退出」:与托盘「退出」同路径(先落库输入栏位置再退出进程) */
  quitApp: () => invoke<void>('quit_app'),
};
