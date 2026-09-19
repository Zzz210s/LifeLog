import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { api } from '../shared/api';
import { completeMatch, sameList, tokenAt } from './tag-complete';

export interface TagCompleteOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 受控值:保存/采纳后程序化清空不走 input 事件,靠它在渲染后关下拉 */
  value: string;
  /** 采纳候选后把替换结果交回受控状态(整体新值) */
  onReplace: (next: string) => void;
}

export interface TagCompleteState {
  /** 有候选且未被 Esc 关闭时为真 */
  open: boolean;
  items: string[];
  activeIndex: number;
  /** 键盘路由:返回 true 表示已消费(调用方不再处理该键);Ctrl/组合键恒不消费 */
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** 采纳指定路径(鼠标点击候选) */
  onPick: (path: string) => void;
}

/**
 * 输入栏 # 标签补全(spec 6.3):
 * - 监听 textarea 的 input/keyup/click,取光标前 # 词元调 completeTags,completeMatch 去重限长
 * - ↑↓ 移动高亮、Enter/Tab 采纳(替换词元并把光标移到末尾)、Esc 关闭(不冒泡,不触发窗口隐藏)
 * - Ctrl/Alt/Win 组合键一律不消费:Ctrl+Enter 保存不受影响;IME 组合中不抢键
 * - 补全请求失败静默关闭下拉,不影响输入与保存
 * - **Esc 关闭按“词元”记名**(dismissedToken):旧实现用一个布尔量,keyup 触发的重算
 *   立刻把它翻回 false,下拉在 Esc 后又弹回来(实测 2026-09-19)。改成“同一词元不再弹”,
 *   词元一变(继续打字或换词)就重新求候选。
 */
export function useTagComplete(opts: TagCompleteOptions): TagCompleteState {
  const [items, setItems] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // 被 Esc 关掉的词元(词元变了就失效);用 ref 是因为重算里要即时读到最新值
  const dismissedToken = useRef<string | null>(null);
  const seq = useRef(0);

  // 受控值变化(如保存后清空)不会触发 input 事件:渲染后若光标前已无 # 词元则关闭下拉
  useEffect(() => {
    const el = opts.textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    if (tokenAt(el.value.slice(0, caret)) === null) {
      seq.current++;
      setItems((prev) => (prev.length === 0 ? prev : [])); // 未变不产生新引用:避免无谓重渲染
    }
  }, [opts.value, opts.textareaRef]);

  useEffect(() => {
    const el = opts.textareaRef.current;
    if (!el) return;
    const recompute = () => {
      const caret = el.selectionStart ?? 0;
      const token = tokenAt(el.value.slice(0, caret));
      if (token === null) {
        seq.current++;
        dismissedToken.current = null; // 离开 # 词元:下次进来重新弹
        setItems((prev) => (prev.length === 0 ? prev : [])); // 同上:没候选时不要重渲染
        return;
      }
      if (dismissedToken.current === token) return; // 这个词元已被 Esc 关掉:保持关闭
      const id = ++seq.current;
      api
        .completeTags(token)
        .then((rows) => {
          if (id !== seq.current) return; // 过期响应丢弃
          if (dismissedToken.current === token) return; // 请求期间被 Esc 关掉
          const next = completeMatch(rows, token);
          setItems((prev) => (sameList(prev, next) ? prev : next));
          setActiveIndex((prev) => (prev === 0 ? prev : 0));
        })
        .catch(() => {
          // 失败静默:退回普通输入(同样不产生无谓重渲染)
          if (id === seq.current) setItems((prev) => (prev.length === 0 ? prev : []));
        });
    };
    el.addEventListener('input', recompute);
    el.addEventListener('keyup', recompute); // 光标移动(方向键)
    el.addEventListener('click', recompute); // 点击换位
    return () => {
      el.removeEventListener('input', recompute);
      el.removeEventListener('keyup', recompute);
      el.removeEventListener('click', recompute);
    };
  }, [opts.textareaRef]);

  /** 采纳:把光标前的 # 词元替换为 #路径+空格,光标落在空格后 */
  const adopt = useCallback(
    (path: string) => {
      const el = opts.textareaRef.current;
      if (!el) return;
      const caret = el.selectionStart ?? 0;
      const token = tokenAt(el.value.slice(0, caret));
      if (token === null) return;
      const start = caret - token.length - 1; // 词元整体 = '#' + 词元本体
      opts.onReplace(el.value.slice(0, start) + '#' + path + ' ' + el.value.slice(caret));
      dismissedToken.current = null; // 词元已被替换掉,下次 # 重新弹
      setItems((prev) => (prev.length === 0 ? prev : [])); // 程序化替换不触发 input 事件,手动关闭
      const newCaret = start + path.length + 2;
      requestAnimationFrame(() => el.setSelectionRange(newCaret, newCaret));
    },
    [opts]
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (items.length === 0 || e.nativeEvent.isComposing) return false;
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        adopt(items[activeIndex] ?? items[0]);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // 只关下拉;窗口级 Esc 隐藏输入栏不触发
        const el = opts.textareaRef.current;
        const caret = el?.selectionStart ?? 0;
        dismissedToken.current = el ? tokenAt(el.value.slice(0, caret)) : null;
        setItems((prev) => (prev.length === 0 ? prev : [])); // 立即收起(keyup 不会再弹回来)
        return true;
      }
      return false;
    },
    [items, activeIndex, adopt, opts.textareaRef]
  );

  return { open: items.length > 0, items, activeIndex, onKeyDown, onPick: adopt };
}
