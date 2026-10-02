/**
 * 输入栏 `[[` 笔记补全(设计 2026-10-01-link-autocomplete-design.md 的 N3):与同目录的
 * `use-tag-complete` **同族但状态各自独立** —— 触发判断复用共享纯函数 `detectLinkTrigger`,
 * 候选池走主窗同一份 `useNoteTitles`(懒取 + 会话内缓存),打分/截断/命中段一律交给共享列表
 * 模型 `buildList`(不另写 matcher,与统一输入框 `use-link-complete` 同一套口径)。
 *
 * 与 `#` 标签补全的互斥不在这里做:两套 hook 各写各的候选态,由宿主 `useInputCompletions`
 * 按 `[[` 优先路由(渲染与键盘都只走一套),因此互不污染,也不必把两份逻辑揉在一起。
 *
 * 触发是**渲染期**从 `value + caret` 推导的(宿主从 textarea 的 onChange/onSelect 上报):
 * 因此 ↑/↓ 改变光标只会触发重渲染,查询没变就**不重算、不归零高亮**(同 `#` 补全的
 * "上下箭头选不动"修复口径)。候选池放在 `query !== null` 之后才懒取(N9:不每击键打 IPC)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { acceptLink, detectLinkTrigger } from '../shared/note-link-trigger';
import { buildList, COMPLETE_LIMIT } from '../shared/quickpick/model';
import type { ListRow, QuickPickItem } from '../shared/quickpick/model';
import type { NoteTitle } from '../shared/types';
import { useNoteTitles } from '../main-window/data/use-note-titles';

export interface LinkCompleteOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 受控镜像值(非受控 textarea 的状态副本):触发判断与「Esc 收起」都读它 */
  value: string;
  /** 当前光标(触发判断的起点;宿主从 onChange/onSelect 上报) */
  caret: number;
  /** 采纳:把替换后的整体正文交回受控状态(与 `#` 补全的 onReplace 同形) */
  onReplace: (next: string) => void;
  /** 候选池作废键(N9 会话内缓存;缺省 0 = 整个窗口会话只取一次) */
  dataVersion?: number;
}

export interface LinkCompleteState {
  /** 有候选且未被 Esc 收起:宿主的渲染与键盘路由都以它为准(与 `#` 补全的 open 同义) */
  open: boolean;
  items: readonly ListRow[];
  activeIndex: number;
  /** 键盘路由:返回 true 表示已消费(宿主不再处理该键);Ctrl/组合键与 IME 组合中恒不消费 */
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** 采纳指定标题(鼠标点击候选与键盘共走这一条) */
  onPick: (title: string) => void;
}

/** 笔记标题 -> 候选项(标题即打分与展示的主文案;id 用笔记 id 保证 React key 稳定) */
function toItems(titles: readonly NoteTitle[]): QuickPickItem[] {
  return titles.map((t) => ({ id: String(t.id), label: t.title }));
}

export function useLinkComplete(opts: LinkCompleteOptions): LinkCompleteState {
  const trigger = detectLinkTrigger(opts.value, opts.caret);
  const query = trigger === null ? null : trigger.query;
  const pool = useNoteTitles(opts.dataVersion ?? 0, query !== null);
  const items = useMemo(
    () =>
      query === null
        ? []
        : buildList({ items: toItems(pool.titles), query, limit: COMPLETE_LIMIT }).rows,
    [pool.titles, query]
  );

  // Esc 收起:记住「在哪段正文上收的」,正文一变(继续打字/删字)就自然重现
  const [mutedOn, setMutedOn] = useState<string | null>(null);
  // 查询一变就把高亮归零;查询没变(↑/↓ 只动光标)时**保留**高亮
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => setActiveIndex(0), [query]);

  const open = query !== null && mutedOn !== opts.value && items.length > 0;

  const adopt = useCallback(
    (title: string) => {
      const el = opts.textareaRef.current;
      if (el === null) return;
      const next = acceptLink(el.value, el.selectionStart ?? 0, title);
      opts.onReplace(next.text);
      setMutedOn(next.text); // 采纳后保持收起(闭合成 `]]` 或宿主的陈旧光标都不再弹)
      requestAnimationFrame(() => el.setSelectionRange(next.caret, next.caret));
    },
    [opts]
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
      // IME 组合中不抢键:React 侧看 isComposing,只给 keyCode 的形态看 229(与统一输入框/编辑框同口径)
      if (items.length === 0 || e.nativeEvent.isComposing || e.keyCode === 229) return false;
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
        if (pick !== undefined) adopt(pick.item.label);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // 只关下拉;窗口级 Esc 隐藏输入栏不触发
        setMutedOn(opts.value);
        return true;
      }
      return false;
    },
    [items, activeIndex, adopt, opts.value]
  );

  return { open, items, activeIndex, onKeyDown, onPick: adopt };
}
