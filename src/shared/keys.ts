/**
 * 上下文键集中声明(D9):组件、命令表与快捷键逻辑只准引用这里的键,禁止裸字符串。
 * 键字符串与键实例成对出现;本文件不引入 React,任何层都可引用。
 */
import { RawContextKey } from './when';
import type { Context, ContextValue } from './when';

/** 键名字符串(as const):事件、日志与测试用;禁止绕过它写字面量 */
export const KEYS = Object.freeze({
  sidebar: 'sidebar',
  editing: 'editing',
  paletteOpen: 'palette.open',
  tabCount: 'tab.count',
  noteSelected: 'note.selected',
} as const);

export type ContextKeyName = keyof typeof KEYS;

/** 键实例:构造 when 表达式 + 读取声明默认值 */
export const CONTEXT = Object.freeze({
  sidebar: new RawContextKey<boolean>(KEYS.sidebar, true),
  editing: new RawContextKey<boolean>(KEYS.editing, false),
  paletteOpen: new RawContextKey<boolean>(KEYS.paletteOpen, false),
  tabCount: new RawContextKey<number>(KEYS.tabCount, 1),
  noteSelected: new RawContextKey<boolean>(KEYS.noteSelected, false),
});

/** 铺满声明默认值的上下文:首帧求值与测试共用(空上下文等价于全部取默认) */
export function defaultContext(): Context {
  const ctx: Record<string, ContextValue> = {};
  for (const key of Object.values(CONTEXT)) ctx[key.key] = key.defaultValue;
  return ctx;
}
