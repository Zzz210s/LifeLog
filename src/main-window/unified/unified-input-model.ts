/**
 * 统一输入框的纯状态机(设计 2026-09-24 §4)。
 *
 * 真源只有 `raw` 一处:`mode/query/prefix` 都是它经 `parseInput` 的派生值,任何
 * action 都先把 raw 写成目标形态再一次性解析,避免三份值互相漂移。
 *
 * 三条容易搞错的语义(都是设计里定死的):
 *  - `dropdownOpen` 只在**有前缀**时为真(记录模式恒 false,D6);
 *  - `esc` 是两级的:有下拉先关下拉(内容与模式不动),没下拉才退模式并清空;
 *  - `accept` 只关下拉、**保留模式**(筛完还能接着筛,找完还能接着找)。
 */
import { parseInput, withPrefix } from '../../shared/input-prefix';
import type { InputMode } from '../../shared/input-prefix';

export interface UnifiedState {
  raw: string;
  mode: InputMode;
  query: string;
  prefix: string;
  dropdownOpen: boolean;
}

export type UnifiedAction =
  | { type: 'set'; raw: string }
  | { type: 'pickPrefix'; prefix: string }
  | { type: 'esc' }
  | { type: 'accept' }
  | { type: 'closeDropdown' }
  | { type: 'clear' };

/** 由 raw 派生整份状态(唯一入口:不许别处再拼 mode/query/prefix) */
export function derive(raw: string, dropdownOpen: boolean): UnifiedState {
  const p = parseInput(raw);
  return { raw, mode: p.mode, query: p.query, prefix: p.prefix, dropdownOpen };
}

export function initialUnified(raw = ''): UnifiedState {
  return derive(raw, false);
}

export function reduceUnified(state: UnifiedState, action: UnifiedAction): UnifiedState {
  switch (action.type) {
    case 'set':
      // 有前缀才开下拉:记录模式不显示候选(D6)
      return derive(action.raw, hasPrefix(action.raw));
    case 'pickPrefix':
      return derive(withPrefix(state.raw, action.prefix), action.prefix !== '');
    case 'esc':
      if (state.dropdownOpen) return { ...state, dropdownOpen: false };
      if (state.prefix === '') return state; // 记录模式 Esc 无动作,不误清草稿
      return initialUnified('');
    case 'accept':
      return { ...state, dropdownOpen: false };
    case 'closeDropdown':
      return { ...state, dropdownOpen: false };
    case 'clear':
      return initialUnified('');
  }
}

function hasPrefix(raw: string): boolean {
  return parseInput(raw).prefix !== '';
}
