/**
 * 上下文键集中声明(D9):组件、命令表与快捷键逻辑只准引用这里的键,禁止裸字符串。
 * 键字符串与键实例成对出现;本文件不引入 React,任何层都可引用。
 *
 * 两条硬约定(I2/I3,T1 审查遗留):
 * 1) **布尔键一律 `.equals(true)` / `.equals(false)`,禁止裸键** —— 裸键是 `defined`,
 *    对 `false` 也为真,而 defaultContext() 会铺满全部键,裸键会让命令/菜单项永不隐藏。
 *    裸键只用来表达「键是否存在」(非布尔键)。
 */
import { RawContextKey } from './when';
import type { Context, ContextValue } from './when';

/** 键名字符串(as const):事件、日志与测试用;禁止绕过它写字面量 */
export const KEYS = Object.freeze({
  sidebar: 'sidebar',
  editing: 'editing',
  paletteOpen: 'palette.open',
  sortNewest: 'sortNewest',
  sortOldest: 'sortOldest',
} as const);

export type ContextKeyName = keyof typeof KEYS;

/** 键实例:构造 when 表达式 + 读取声明默认值 */
export const CONTEXT = Object.freeze({
  sidebar: new RawContextKey<boolean>(KEYS.sidebar, true),
  editing: new RawContextKey<boolean>(KEYS.editing, false),
  paletteOpen: new RawContextKey<boolean>(KEYS.paletteOpen, false),
  /** 排序态(条件栏的"最新/最早"由这两个键驱动命令勾选态);默认最新在前 */
  sortNewest: new RawContextKey<boolean>(KEYS.sortNewest, true),
  sortOldest: new RawContextKey<boolean>(KEYS.sortOldest, false),
});

/** 铺满声明默认值的上下文:首帧求值与测试共用(空上下文等价于全部取默认) */
export function defaultContext(): Context {
  const ctx: Record<string, ContextValue> = {};
  for (const key of Object.values(CONTEXT)) ctx[key.key] = key.defaultValue;
  return ctx;
}
