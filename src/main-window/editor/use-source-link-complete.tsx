/**
 * 卡片就地编辑(源码框)里的 `[[` 补全接线(设计 N4)。
 *
 * **复用**统一输入框那一套,不另起一份逻辑:
 *  - 候选:`useLinkComplete`(`detectLinkTrigger` 判上下文 / `useNoteTitles` 懒取会话内缓存 /
 *    `buildList` 打分截断高亮 / `excludeId` 排除正在编辑的自己);
 *  - 键盘:`useUnifiedKeys`(`routeUnifiedKey` 的 IME 守卫、Ctrl+Enter 保存、Esc);
 *  - 行:浮层 `PaletteRow`(经 `SourceLinkList`)。
 *
 * 本文件只补两件编辑器特有的事:
 *  1. **非受控** textarea —— 采纳用原型 value setter 写回并 `setSelectionRange` 落光标(写 DOM
 *     的同时回写宿主的镜像与光标,否则下一帧按陈旧光标会立刻把下拉又判成命中);
 *  2. **Esc 两级** —— 下拉开着只收起下拉(不动正文、不退出编辑),下拉未开才 `onCancel`。
 *     这条由 `routeUnifiedKey` 天然的「Esc 永远路由给 esc 回调」+ 本 hook 的 esc 分流实现。
 */
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { acceptLink } from '../../shared/note-link-trigger';
import { renderRowCount } from '../palette/palette-limits';
import { useUnifiedKeys } from '../unified/use-unified-keys';
import { useLinkComplete } from '../unified/use-link-complete';
import { activeEditLinkOptionId, SourceLinkList } from './SourceLinkList';

export interface SourceLinkOptions {
  boxRef: RefObject<HTMLTextAreaElement | null>;
  /** 非受控源码框的文本镜像(触发判断读它;采纳仍以 DOM 为真源) */
  source: string;
  /** 当前光标(`onChange`/`onSelect` 上报;触发判断的起点) */
  caret: number;
  /** 正在编辑的这条(候选里排除它自己,设计 N3) */
  excludeId: number;
  /** 采纳写回:新文本与光标交给宿主(非受控框的 DOM 值由本 hook 直接写) */
  onWritten: (text: string, caret: number) => void;
  /** Ctrl/Cmd+Enter:保存并回预览(与面板既有快捷键同一条通道) */
  onSave: () => void;
  /** Esc:下拉未开时取消编辑 */
  onCancel: () => void;
}

export interface SourceLinkState {
  /** 键盘路由:挂在源码框 `onKeyDown` 上 */
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** 高亮行 DOM id(空/越界给 null):源码框的 `aria-activedescendant` */
  activeOptionId: string | null;
  /** 候选下拉节点(关闭时为 null) */
  list: ReactNode;
}

export function useSourceLinkComplete(o: SourceLinkOptions): SourceLinkState {
  // dataVersion 恒 0:本 hook 随 EditPanel 每次进编辑重新挂载,池天然按会话重取一次(N9)
  const link = useLinkComplete({ raw: o.source, caret: o.caret, dataVersion: 0, excludeId: o.excludeId });
  const rows = link.controller.rows;

  const accept = (index: number): void => {
    const el = o.boxRef.current;
    const row = rows[index];
    if (el === null || row === undefined) return;
    const next = acceptLink(el.value, el.selectionStart ?? 0, row.item.label);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, next.text);
    el.setSelectionRange(next.caret, next.caret);
    link.dismiss(); // 采纳后保持收起(直到正文再变一次)
    o.onWritten(next.text, next.caret);
  };

  const onKeyDown = useUnifiedKeys({
    dropdownShown: link.active,
    activeIndex: link.controller.activeIndex,
    count: renderRowCount(rows.length),
    save: o.onSave,
    esc: () => (link.active ? link.dismiss() : o.onCancel()),
    highlight: (index) => link.controller.setActiveIndex(index),
    accept,
  });

  return {
    onKeyDown,
    activeOptionId: activeEditLinkOptionId(rows.length, link.controller.activeIndex),
    list: (
      <SourceLinkList
        open={link.active}
        rows={rows}
        activeIndex={link.controller.activeIndex}
        onHover={(index) => link.controller.setActiveIndex(index)}
        onAccept={accept}
      />
    ),
  };
}
