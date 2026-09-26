import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { api } from '../shared/api';
import type { MruEntry } from '../shared/quickpick/model';
import { completeMatch, sameList, tokenAt } from './tag-complete';
import type { CompleteRow } from './tag-complete';

/** 固定项 / 标签 MRU / 落盘调度的注入面(结构类型):由 `usePaletteSettings` 提供,
 *  输入栏不反向依赖主窗浮层的具体类型,只依赖它俩字段 */
export interface TagMruSource {
  /** 固定项(`ui.pinned.tags`),数组顺序即固定档顺序 */
  readonly pinnedTags: readonly string[];
  /** 标签 MRU(`ui.mru.tags`,id = 标签完整路径) */
  readonly mruTags: { touch(id: string): void; entries(): MruEntry[] };
}

export interface TagCompleteOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 受控值:保存/采纳后程序化清空不走 input 事件,靠它在渲染后关下拉 */
  value: string;
  /** 采纳候选后把替换结果交回受控状态(整体新值) */
  onReplace: (next: string) => void;
  /** 固定项与 MRU;null/缺省 = 还没读回来(按无固定项、无 MRU 处理) */
  settings?: TagMruSource | null;
  /** 采纳后标脏 MRU 的空闲落盘调度(缺省不落盘) */
  onMruChange?: () => void;
}

export interface TagCompleteState {
  /** 有候选且未被 Esc 关闭时为真 */
  open: boolean;
  items: CompleteRow[];
  activeIndex: number;
  /** 键盘路由:返回 true 表示已消费(调用方不再处理该键);Ctrl/组合键恒不消费 */
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** 采纳指定路径(鼠标点击候选):恒传目标标签路径(别名候选也写入规范路径) */
  onPick: (path: string) => void;
}

/**
 * 输入栏 # 标签补全(spec 6.3 / T8):
 * - 监听 textarea 的 input/keyup/click,取光标前 # 词元调 completeTags,再交给 `completeMatch`
 *   做「固定项 -> 最近用过 -> 全量」三档 / 有词元按 fuzzy-score 排序(引擎与主窗浮层同源)
 * - 候选带来源标记(G3/G4):别名命中项 kind=alias、近义提示项 kind=similar,
 *   采纳时写入的都是目标标签的规范路径(近义项只是提示,绝不自动改写输入)
 * - ↑↓ 移动高亮、Enter/Tab 采纳(替换词元并把光标移到末尾)、Esc 关闭(不冒泡,不触发窗口隐藏)
 * - Ctrl/Alt/Win 组合键一律不消费:Ctrl+Enter 保存不受影响;IME 组合中不抢键
 * - 补全请求失败静默关闭下拉,不影响输入与保存
 * - **取消在途**:每次词元变化、离开词元、程序化清空、采纳都递增序号,旧回包(含乱序回包)直接丢;
 *   采纳时还要丢弃「同一词元」的在途请求,否则回包会把刚收起的列表又弹回来(实测 2026-09-22)
 * - **Esc 关闭按“词元”记名**(dismissedToken):旧实现用一个布尔量,keyup 触发的重算
 *   立刻把它翻回 false,下拉在 Esc 后又弹回来(实测 2026-09-19)。改成“同一词元不再弹”,
 *   词元一变(继续打字或换词)就重新求候选。
 */
export function useTagComplete(opts: TagCompleteOptions): TagCompleteState {
  const [items, setItems] = useState<CompleteRow[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // 被 Esc 关掉的词元(词元变了就失效);用 ref 是因为重算里要即时读到最新值
  const dismissedToken = useRef<string | null>(null);
  const seq = useRef(0);
  // 设置是异步读回来的,而监听器只挂一次:用 ref 现读,免得闭包里拿的是挂载时的旧值
  const settings = useRef(opts.settings);
  settings.current = opts.settings;

  /** 候选列表的镜像:重算路径要现读"列表是否真变了"(见 setList),不靠渲染期闭包 */
  const itemsRef = useRef<CompleteRow[]>([]);

  /**
   * 候选列表的**唯一写入点**:列表没变就什么都不做(不重渲染、**不归零高亮**),
   * 变了才换列表并把高亮归零(新一批候选应该从第一行开始)。
   *
   * 为什么不能无条件归零:↓/↑ 的 keyup 会触发重算,回包里的"归零"会把刚移动的高亮打回第一行 ——
   * 症状就是"上下箭头选不动"(实测 2026-09-26)。
   */
  const setList = useCallback((next: CompleteRow[]) => {
    if (sameList(itemsRef.current, next)) return;
    itemsRef.current = next;
    setItems(next);
    setActiveIndex(0);
  }, []);

  const clear = useCallback(() => {
    if (itemsRef.current.length === 0) return; // 未变不产生新引用:避免无谓重渲染
    itemsRef.current = [];
    setItems([]);
  }, []);

  // 受控值变化(如保存后清空)不会触发 input 事件:渲染后若光标前已无 # 词元则关闭下拉
  useEffect(() => {
    const el = opts.textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    if (tokenAt(el.value.slice(0, caret)) === null) {
      seq.current++;
      clear();
    }
  }, [opts.value, opts.textareaRef, clear]);

  useEffect(() => {
    const el = opts.textareaRef.current;
    if (!el) return;
    const recompute = () => {
      const caret = el.selectionStart ?? 0;
      const token = tokenAt(el.value.slice(0, caret));
      if (token === null) {
        seq.current++;
        dismissedToken.current = null; // 离开 # 词元:下次进来重新弹
        clear();
        return;
      }
      if (dismissedToken.current === token) return; // 这个词元已被 Esc 关掉:保持关闭
      const id = ++seq.current;
      api
        .completeTags(token)
        .then((candidates) => {
          if (id !== seq.current) return; // 过期响应(含乱序回包)丢弃
          if (dismissedToken.current === token) return; // 请求期间被 Esc 关掉
          const current = settings.current;
          const next = completeMatch(candidates, token, {
            pinned: current?.pinnedTags ?? [],
            mru: current?.mruTags.entries() ?? [],
          });
          setList(next);
        })
        .catch(() => {
          // 失败静默:退回普通输入(同样不产生无谓重渲染)
          if (id === seq.current) clear();
        });
    };
    /** keyup:光标移动(方向键)/松键后重算;但下拉开着时的 ↑/↓ 已被 keydown 消费 —— 光标没动、
     *  候选也不可能变,重算只会白跑一次 IPC(高亮另有 setList 的"没变不归零"兜住) */
    const onKeyUp = (e: KeyboardEvent): void => {
      const arrows = e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if (arrows && itemsRef.current.length > 0) return;
      recompute();
    };
    el.addEventListener('input', recompute);
    el.addEventListener('keyup', onKeyUp);
    el.addEventListener('click', recompute); // 点击换位
    return () => {
      el.removeEventListener('input', recompute);
      el.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('click', recompute);
    };
  }, [opts.textareaRef, clear, setList]);

  /** 采纳:把光标前的 # 词元替换为 #路径+空格,光标落在空格后 */
  const adopt = useCallback(
    (path: string) => {
      const el = opts.textareaRef.current;
      if (el === null) return;
      const caret = el.selectionStart ?? 0;
      const token = tokenAt(el.value.slice(0, caret));
      if (token === null) return;
      seq.current++; // 作废在途请求:采纳后旧回包不得把刚收起的列表又弹回来
      dismissedToken.current = null; // 词元已被替换掉,下次 # 重新弹
      settings.current?.mruTags.touch(path); // 「最近用过」只在采纳时计数
      opts.onMruChange?.();
      const start = caret - token.length - 1; // 词元整体 = '#' + 词元本体
      opts.onReplace(el.value.slice(0, start) + '#' + path + ' ' + el.value.slice(caret));
      clear(); // 程序化替换不触发 input 事件,手动关闭
      const newCaret = start + path.length + 2;
      requestAnimationFrame(() => el.setSelectionRange(newCaret, newCaret));
    },
    [opts, clear]
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
        const pick = items[activeIndex] ?? items[0];
        if (pick !== undefined) adopt(pick.path);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // 只关下拉;窗口级 Esc 隐藏输入栏不触发
        const el = opts.textareaRef.current;
        const caret = el?.selectionStart ?? 0;
        dismissedToken.current = el ? tokenAt(el.value.slice(0, caret)) : null;
        clear(); // 立即收起(keyup 不会再弹回来)
        return true;
      }
      return false;
    },
    [items, activeIndex, adopt, opts.textareaRef, clear]
  );

  return { open: items.length > 0, items, activeIndex, onKeyDown, onPick: adopt };
}
