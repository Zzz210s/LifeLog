import { invoke } from '@tauri-apps/api/core';
import type { CarryReport, CompleteItem, DbInfo, ExprCheck, GraphData, GraphLinkDegrees, MergeReport, Note, NoteLinks, NoteTitle, ParseResult, RelationRef, TypeRef, TagCount, TagImpact } from './types';
import type { ConditionHits, TagFactsBundle } from './tag-facts-types';
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
  /** 添加标签携带关系(幂等):自携带 / 成环 / 标签不存在都会 reject 中文原因 */
  setTagCarry: (carrierId: number, carriedId: number) =>
    invoke<void>('set_tag_relation', { fromTag: carrierId, toTag: carriedId }),
  /** 移除标签携带关系(幂等:不存在也算成功) */
  removeTagCarry: (carrierId: number, carriedId: number) =>
    invoke<void>('remove_tag_relation', { fromTag: carrierId, toTag: carriedId }),
  /** 双向携带读数:carried 是本标签携带的,carriersOf 是携带本标签的(旧「携带…」面板兼容) */
  listTagCarries: async (carrierId: number): Promise<CarryReport> => {
    const [out, facts, tags] = await Promise.all([
      api.listTagRelations(carrierId),
      api.listTagFacts(),
      api.listTags(),
    ]);
    const pathOf = new Map(tags.map((t) => [t.id, t.path] as const));
    const carried = out.map((r) => ({ id: r.toTagId, path: r.path }));
    const carriersOf = facts.facts
      .filter((f) => f.relations.some((r) => r.toTagId === carrierId))
      .map((f) => ({ id: f.tagId, path: pathOf.get(f.tagId) ?? '' }))
      .filter((r) => r.path !== '')
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { carried, carriersOf };
  },
  /** 有入边的标签路径集合(去重、升序):条件栏摘要据此决定是否显示 `+携带` 小字 */
  carriedTagPaths: () => invoke<string[]>('carried_tag_paths'),
  /** 设置/取消「类型」标记:022 已删 `tags.is_type`,「谁能当类型」的登记不再存在(任何标签都能被指向)。
   *  过渡期**明确 reject 中文原因**而不是静默 resolve —— 点了没反应等于吞掉用户意图;
   *  侧栏「设为类型」入口由 T4 换成关系徽章后本方法一并删除。 */
  setTagTypeFlag: (_tagId: number, _isType: boolean): Promise<void> =>
    Promise.reject('类型登记已随迁移 022 取消(任何标签都能被指向);关系徽章待后续任务接入'),
  /** 整体替换某标签的类型认领(过渡期兼容层)。
   *  **已知缺陷(过渡期)**:后端的整体替换原本是一条事务,这里被拆成 N 次顺序 IPC(先删后加),
   *  中途失败会留下半套边(既没删完也没加完),调用方需自行容忍半写。T4 把类型认领全面换成
   *  关系读写后,本兼容层连同调用方一起删除,或改由后端提供单事务的关系整体替换命令。 */
  setTagTypes: async (tagId: number, typeIds: number[]): Promise<void> => {
    const current = await api.listTagRelations(tagId);
    const want = new Set(typeIds);
    const have = new Set(current.map((r) => r.toTagId));
    for (const r of current) if (!want.has(r.toTagId)) await api.removeTagRelation(tagId, r.toTagId);
    for (const id of want) if (!have.has(id)) await api.setTagRelation(tagId, id);
  },
  /** 全部可被指向的标签(022 起任何标签都可以,旧「类型」候选直接用全量标签) */
  listTypes: async (): Promise<TypeRef[]> => {
    const tags = await api.listTags();
    return tags.map((t) => ({
      tagId: t.id,
      path: t.path,
      name: t.path.split('/').pop() ?? t.path,
    }));
  },
  /** 某标签的全部出边(旧「类型…」回显):映射成旧的 TypeRef 形状 */
  listTagTypes: async (tagId: number): Promise<TypeRef[]> =>
    (await api.listTagRelations(tagId)).map((r) => ({
      tagId: r.toTagId,
      path: r.path,
      name: r.name,
    })),
  /** 全量标签关系事实(批量只读,一次 IPC 取全):侧栏树行/悬浮卡片共用 */
  listTagFacts: () => invoke<TagFactsBundle>('list_tag_facts'),
  /** 建立标签关系 A -> B(幂等):自指向 / 成环 / 标签不存在都会 reject 中文原因 */
  setTagRelation: (fromTag: number, toTag: number) =>
    invoke<void>('set_tag_relation', { fromTag, toTag }),
  /** 移除标签关系 A -> B(幂等:不存在也算成功) */
  removeTagRelation: (fromTag: number, toTag: number) =>
    invoke<void>('remove_tag_relation', { fromTag, toTag }),
  /** 某标签的全部出边(A -> ?):每项含目标 id / 路径 / 末段名 / 名字备注 */
  listTagRelations: (fromTag: number) =>
    invoke<RelationRef[]>('list_tag_relations', { fromTag }),
  /** 条件栏「命中 N 条」读数:每个标签/类型条件独立计数(不叠加其它条件) */
  conditionHitCounts: (conditions: FilterConditions) =>
    invoke<ConditionHits>('condition_hit_counts', { conditions }),
  /** 合并标签(G2 命令):转移链接 + 可选保留旧名为别名,返回转移读数 */
  mergeTags: (sourceId: number, targetId: number, keepAlias: boolean) =>
    invoke<MergeReport>('merge_tags', { sourceId, targetId, keepAlias }),
  /** 输入栏补全:按路径前缀列出候选(别名命中项的 kind=alias) */
  completeTags: (prefix: string) => invoke<CompleteItem[]>('complete_tags', { prefix }),
  /** `[[` 补全的候选池:全部笔记的显示首行。不传 prefix 回整池(前端会话内缓存);
   *  传 prefix 时后端粗筛(子串档在前、子序列档在后)并截到 200 条 */
  completeNotes: (prefix?: string) => invoke<NoteTitle[]>('complete_notes', { prefix }),
  /** 更新笔记:**标签集合整集合替换**为正文里的 #标签 —— 调用方必须自带该笔记的全部标签(UI 编辑框会回显),否则会丢标签 */
  updateNote: (id: number, content: string) =>
    invoke<Note | null>('update_note', { id, content }),
  /** 一页笔记的被引用计数(批量一次 `IN (...)` 取全,前端把 Map 分给各卡);
   *  N=0 的 id 不在返回里(读 `.get` 得 undefined 与 0 同义) */
  noteLinkCounts: (noteIds: number[]) =>
    invoke<Record<number, number>>('note_link_counts', { noteIds }),
  /** 单条笔记的出链 + 入链(卡片/编辑面板的反向引用列表,点开时才拉) */
  noteLinks: (noteId: number) => invoke<NoteLinks>('note_links', { noteId }),
  deleteNote: (id: number) => invoke<void>('delete_note', { id }),
  /** 解析笔记源码 -> 保存后的正文 + 标签集合(与保存路径共用同一实现,解析的唯一真源);
   *  编辑面板用它实时显示标签数,前端不复制标签语法 */
  parseNoteSource: (source: string) => invoke<ParseResult>('parse_note_source', { source }),
  exportNotes: (path: string) => invoke<void>('export_notes', { path }),
  hideInputBar: () => invoke<void>('hide_input_bar'),
  /** 隐藏主窗(与标题栏 X、托盘同一语义;页面发起的 window.close() 走这条 —— 待办 #36) */
  hideMainWindow: () => invoke<void>('hide_main_window'),
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
  /** 用户点了输入栏:允许它取焦点(默认唤起不夺焦点,见 Rust input::show) */
  focusInputBar: () => invoke<void>('focus_input_bar'),
  /** 输入栏当前是否可见(新手引导临时收起前的问询;系统口径) */
  inputBarVisible: () => invoke<boolean>('input_bar_visible'),
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
  /** 关系图数据(只读):节点(含子级笔记数)+ 父子/共现边 + 笔记间链接边,进入视图时拉一次 */
  graphData: () => invoke<GraphData>('graph_data'),
  /** 某标签(含子孙)的出链 / 入链(信息条;选中标签时才拉,重选重拉) */
  graphLinkDegrees: (tagId: number) => invoke<GraphLinkDegrees>('graph_link_degrees', { tagId }),
};
