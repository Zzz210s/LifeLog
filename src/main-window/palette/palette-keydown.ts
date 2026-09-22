/**
 * 浮层按键 -> 动作(纯函数,自 `use-palette.ts` 抽出以守行数红线)。
 *
 * 只做「哪个键 = 哪个动作」的映射;是否忽略(repeat / 输入法组合 / 目标是浮层外的可编辑元素)
 * 与状态推进(循环取模、夹紧)留在 hook 里。`Escape` 不 preventDefault(用户按 Esc 就是要关浮层,
 * 原控件行为不需要被挡);`Tab` 要 preventDefault(关浮层的同时不让焦点按默认顺序跳到别处)。
 */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export type KeyAction =
  | { type: 'ignore' }
  | { type: 'move'; delta: number }
  | { type: 'set'; index: number }
  | { type: 'accept'; keepOpen: boolean }
  | { type: 'close'; preventDefault: boolean };

/** PageUp/PageDown 的跨页步长(设计未给值:渲染上限 200,取 10 便于扫读) */
export const PAGE_STEP = 10;

/** 边界循环取模(上下方向键与翻页共用;total 为 0 时恒 0) */
export function wrapIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (((current + delta) % total) + total) % total;
}

export function resolveKeyAction(event: KeyLike): KeyAction {
  switch (event.key) {
    case 'ArrowDown': return { type: 'move', delta: 1 };
    case 'ArrowUp': return { type: 'move', delta: -1 };
    case 'PageDown': return { type: 'move', delta: PAGE_STEP };
    case 'PageUp': return { type: 'move', delta: -PAGE_STEP };
    case 'Home': return { type: 'set', index: 0 };
    case 'End': return { type: 'set', index: -1 }; // -1 = 末项(总数为 0 时 hook 会夹到 0)
    case 'Enter':
      // Ctrl/Cmd+Enter 是别的组件的组合(Composer 的保存),浮层不抢(审查 N4);
      // Alt+Enter 仍是「接受但不关闭」(设计 §3.1)。
      if (event.ctrlKey || event.metaKey) return { type: 'ignore' };
      return { type: 'accept', keepOpen: event.altKey };
    case 'Escape': return { type: 'close', preventDefault: false };
    case 'Tab': return { type: 'close', preventDefault: true };
    default: return { type: 'ignore' };
  }
}
