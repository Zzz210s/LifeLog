/**
 * 命令注册表(D3):一条声明 = 命令 + 启用条件(when) + 可选勾选态(toggled) + 副作用(run)。
 * 命令/上下文键/表达式全部代码内声明,不入库(D11);本模块在启动时构造一次,不做动态注册。
 * 纯数据 + 纯函数,无 IO、无 React;副作用接线在 T6,此处 run 一律是抛错的占位。
 */
import { CONTEXT } from './keys';
import { TRUE, evaluate } from './when';
import type { Context, ContextKeyExpr } from './when';

export interface CommandDef {
  readonly id: string;
  readonly title: string;
  readonly aliases?: readonly string[];
  /** 启用条件:为假则命令不出现在列表里;缺省 = 恒真 */
  readonly when?: ContextKeyExpr;
  /** 勾选态(复选型命令,如侧栏开关):由上下文键驱动;缺省 = 无勾选态 */
  readonly toggled?: ContextKeyExpr;
  /** 有不可逆副作用的命令(导出/重建索引/退出),列表里标危险色 */
  readonly danger?: boolean;
  readonly run?: () => void | Promise<void>;
}

export interface Command {
  readonly id: string;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly when: ContextKeyExpr;
  readonly toggled?: ContextKeyExpr;
  readonly danger: boolean;
  readonly run: () => void | Promise<void>;
}

export interface CommandRegistry {
  readonly all: readonly Command[];
  /** when 为真(按上下文求值)的命令,保持声明顺序 */
  list(ctx: Context): readonly Command[];
  find(id: string): Command | undefined;
}

/** T6 之前的占位副作用:调用即抛,界面会显示中文错误条 */
function notWired(id: string): () => never {
  // TODO(T6): 接入真实副作用(新建笔记/切标签/导出/重建索引/退出等)
  return () => {
    throw new Error(`命令「${id}」尚未接线(T6)`);
  };
}

function normalizeCommand(def: CommandDef, seen: Set<string>): Command {
  const id = (def.id ?? '').trim();
  if (id === '') throw new Error('命令 id 不能为空');
  if (seen.has(id)) throw new Error(`命令 id 重复:${id}`);
  seen.add(id);
  const title = (def.title ?? '').trim();
  if (title === '') throw new Error(`命令 ${id} 缺少标题(title 必填)`);
  const aliases = (def.aliases ?? []).map((a) => a.trim()).filter((a) => a !== '');
  return Object.freeze({
    id,
    title,
    aliases: Object.freeze(aliases),
    when: def.when ?? TRUE,
    toggled: def.toggled,
    danger: def.danger ?? false,
    run: def.run ?? notWired(id),
  });
}

export function defineCommands(defs: readonly CommandDef[]): CommandRegistry {
  const seen = new Set<string>();
  const all = Object.freeze(defs.map((d) => normalizeCommand(d, seen)));
  return Object.freeze({
    all,
    list: (ctx: Context) => all.filter((c) => evaluate(c.when, ctx)),
    find: (id: string) => all.find((c) => c.id === id),
  });
}

/** 接线映射:命令 id -> 真实副作用(缺 id 由 withRuns 报错) */
export type CommandRuns = Readonly<Record<string, () => void | Promise<void>>>;

/**
 * 把真实副作用接到注册表上(T3 审查 Important 1)。
 * 缺 id 即抛中文错误并列出全部缺失 id —— 漏接在构造期/测试期就失败,
 * 不会退化成 `notWired` 的静默占位(界面上表现成「点了没反应」)。
 */
export function withRuns(registry: CommandRegistry, runs: CommandRuns): CommandRegistry {
  const missing = registry.all.filter((c) => !Object.prototype.hasOwnProperty.call(runs, c.id));
  if (missing.length > 0) {
    throw new Error(`命令未接线(withRuns 缺少 run):${missing.map((c) => c.id).join('、')}`);
  }
  return defineCommands(registry.all.map((c) => ({ ...c, run: runs[c.id] })));
}

/** 命令清单(设计 §3.7;14 条 = 原 11 条 + 排序 ×2 + 添加条件)。id/title/aliases/when/toggled/danger 定型,T5/T6 依赖。 */
export const COMMANDS: CommandRegistry = defineCommands([
  { id: 'note.new', title: '新建笔记', aliases: ['new', 'create', '写'] },
  { id: 'tab.next', title: '切换标签页(下一个)', aliases: ['tab', 'next'], when: CONTEXT.tabMultiple.equals(true) },
  { id: 'tab.prev', title: '切换标签页(上一个)', aliases: ['tab', 'prev'], when: CONTEXT.tabMultiple.equals(true) },
  { id: 'settings.open', title: '打开设置', aliases: ['settings', '偏好'] },
  { id: 'theme.cycle', title: '切换主题', aliases: ['theme', 'dark', '暗色'] },
  { id: 'sidebar.toggle', title: '隐藏侧栏 / 显示侧栏', aliases: ['sidebar'], toggled: CONTEXT.sidebar.equals(true) },
  { id: 'focus.mode', title: '专注模式', aliases: ['zen', '专注'] },
  { id: 'sort.newest', title: '最新在前', aliases: ['最新', 'sort'], toggled: CONTEXT.sortNewest.equals(true) },
  { id: 'sort.oldest', title: '最早在前', aliases: ['最早'], toggled: CONTEXT.sortOldest.equals(true) },
  { id: 'filter.addCondition', title: '添加条件', aliases: ['筛选', '条件'] },
  { id: 'export.all', title: '导出整库', aliases: ['export', 'xlsx'], danger: true },
  { id: 'search.reindex', title: '重建搜索索引', aliases: ['reindex', 'fts'], danger: true },
  { id: 'hotkey.edit', title: '改全局热键', aliases: ['hotkey'] },
  { id: 'app.quit', title: '退出', aliases: ['quit', 'exit'], danger: true },
]);

/** 便捷视图:注册表在启动时构造一次,这两个函数是它的只读入口 */
export function listCommands(ctx: Context): readonly Command[] {
  return COMMANDS.list(ctx);
}

export function findCommand(id: string): Command | undefined {
  return COMMANDS.find(id);
}
