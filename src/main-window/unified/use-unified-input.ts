/**
 * 统一输入框的 React 包装(设计 2026-09-24 §4)。
 *
 * 状态全在纯状态机里,这里只做两件事:
 *  1) 把 action 派发出去;
 *  2) `prefill(prefix)` 时递增 `focusSignal`,让输入框组件据此把焦点抢回来
 *     (快捷键 Ctrl+P / Ctrl+Shift+P 的语义 = 聚焦这一个框并预填前缀,
 *      见计划 Task 7;不在这里直接 focus,是因为 ref 归组件所有)。
 */
import { useCallback, useReducer, useState } from 'react';
import { initialUnified, reduceUnified, type UnifiedState } from './unified-input-model';

export interface UnifiedController {
  state: UnifiedState;
  /** 焦点请求计数:每次递增都表示"请把焦点给输入框"(组件用 effect 监听) */
  focusSignal: number;
  setRaw: (raw: string) => void;
  pickPrefix: (prefix: string) => void;
  /** 快捷键预填:聚焦并带上前缀(空前缀 = 记录模式) */
  prefill: (prefix: string) => void;
  /** Esc 两级:有下拉先关下拉,否则退模式(记录模式无动作) */
  esc: () => void;
  clear: () => void;
  closeDropdown: () => void;
}

export function useUnifiedInput(initialRaw = ''): UnifiedController {
  // 惰性初始化 + 明确"仅挂载生效":后续改 initialRaw 不会重置状态
  const [state, dispatch] = useReducer(reduceUnified, initialRaw, initialUnified);
  // 焦点请求用 state 而不是 ref:ref 变更不触发渲染,焦点会静默丢失(2026-09-24 评审)
  const [focusSignal, setFocusSignal] = useState(0);

  const setRaw = useCallback((raw: string) => dispatch({ type: 'set', raw }), []);
  const pickPrefix = useCallback((prefix: string) => dispatch({ type: 'pickPrefix', prefix }), []);
  const esc = useCallback(() => dispatch({ type: 'esc' }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const closeDropdown = useCallback(() => dispatch({ type: 'closeDropdown' }), []);

  // prefill 与 pickPrefix 的区别只在"顺带把焦点抢回来",状态迁移完全一样
  const prefill = useCallback((prefix: string) => {
    dispatch({ type: 'pickPrefix', prefix });
    setFocusSignal((n) => n + 1);
  }, []);

  return {
    state,
    focusSignal,
    setRaw,
    pickPrefix,
    prefill,
    esc,
    clear,
    closeDropdown,
  };
}
