/**
 * 输入栏两套补全的统一路由(设计 N3 接线):`[[` 笔记候选 与 `#` 标签候选 **二选一**。
 *
 * 存在的理由:两套 hook 各自独立(见 `use-link-complete` / `use-tag-complete` 的文件头),
 * 但输入栏只有一个列表、一套键盘 —— 需要一处决定「这一帧谁在台面上」,也得保证键盘不会
 * 同时落进两边。这里只做路由与渲染,**不互相写对方的状态**:
 * - 优先级与统一输入框一致:命中未闭合 `[[` 时用笔记候选,否则沿用标签候选;
 * - `link.onKeyDown` 只在 `[[` 命中时被调用,标签补全在那种上下文里收不到任何键。
 */
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { noteMruOf } from '../main-window/palette/palette-mru';
import type { PaletteSettingsApi } from '../main-window/palette/use-palette-settings';
import { suggestListHeightCss } from '../shared/input-geometry';
import { LinkCompleteList } from './LinkCompleteList';
import { TagCompleteList } from './TagCompleteList';
import { useLinkComplete } from './use-link-complete';
import { useTagComplete } from './use-tag-complete';

export interface InputCompletionsOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 非受控 textarea 的值镜像 */
  value: string;
  /** 当前光标(`[[` 触发判断用;宿主从 onChange/onSelect 上报) */
  caret: number;
  /** 采纳:把替换后的整体正文交回受控状态 */
  onReplace: (next: string) => void;
  /** 浮层设置(固定项/标签 MRU/笔记 MRU 共用同一份实例);缺省 = 还没读回来 */
  palette?: PaletteSettingsApi | null;
  /** 笔记候选池作废键 */
  dataVersion?: number;
}

export interface InputCompletions {
  /** 下拉占的 CSS 高度(0 = 无下拉;宿主据此调窗口高度) */
  listHeight: number;
  /** 下拉节点(任一路为空时渲染出 null) */
  list: ReactNode;
  /** 键盘路由:返回 true 表示已消费(宿主不再处理该键) */
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
}

export function useInputCompletions(o: InputCompletionsOptions): InputCompletions {
  const settings = o.palette?.settings ?? null;
  const tag = useTagComplete({
    textareaRef: o.textareaRef,
    value: o.value,
    onReplace: o.onReplace,
    settings,
    onMruChange: o.palette?.saveMruSoon,
  });
  const link = useLinkComplete({
    textareaRef: o.textareaRef,
    value: o.value,
    caret: o.caret,
    onReplace: o.onReplace,
    dataVersion: o.dataVersion,
    mru: noteMruOf(settings, o.palette?.saveMruSoon),
  });

  // `[[` 命中即由链接候选接管;否则标签候选照旧(空候选时列表渲染为 null,高度也为 0)
  const linkFirst = link.open;
  const count = linkFirst ? link.items.length : tag.items.length;
  const listHeight = count > 0 ? suggestListHeightCss(count) : 0;
  const list = linkFirst ? (
    <LinkCompleteList items={link.items} activeIndex={link.activeIndex} onPick={link.onPick} />
  ) : (
    <TagCompleteList items={tag.items} activeIndex={tag.activeIndex} onPick={tag.onPick} />
  );

  return {
    listHeight,
    list,
    onKeyDown: (e) => (linkFirst ? link.onKeyDown(e) : tag.onKeyDown(e)),
  };
}
