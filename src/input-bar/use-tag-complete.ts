import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { api } from '../shared/api';
import { completeMatch, tokenAt } from './tag-complete';

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
 */
export function useTagComplete(opts: TagCompleteOptions): TagCompleteState {
  const [items, setItems] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const seq = useRef(0);

  // 受控值变化(如保存后清空)不会触发 input 事件:渲染后若光标前已无 # 词元则关闭下拉
  useEffect(() => {
    const el = opts.textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    if (tokenAt(el.value.slice(0, caret)) === null) {
      seq.current++;
      setItems([]);
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
        setItems([]);
        return;
      }
      const id = ++seq.current;
      api
        .completeTags(token)
        .then((rows) => {
          if (id !== seq.current) return; // 过期响应丢弃
          setItems(completeMatch(rows, token));
          setActiveIndex(0);
          setDismissed(false);
        })
        .catch(() => {
          if (id === seq.current) setItems([]); // 失败静默:退回普通输入
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
      setItems([]); // 程序化替换不触发 input 事件,手动关闭
      const newCaret = start + path.length + 2;
      requestAnimationFrame(() => el.setSelectionRange(newCaret, newCaret));
    },
    [opts]
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (items.length === 0 || dismissed || e.nativeEvent.isComposing) return false;
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
        setDismissed(true);
        return true;
      }
      return false;
    },
    [items, activeIndex, dismissed, adopt]
  );

  return { open: items.length > 0 && !dismissed, items, activeIndex, onKeyDown, onPick: adopt };
}
