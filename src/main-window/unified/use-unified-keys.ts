/**
 * 唯一输入框的键盘接线(修复轮 1 从 UnifiedInput 抽出,给该文件腾出 200 行额度):
 * 把 React 的 keydown 交给纯函数 `routeUnifiedKey`,再把动作分派给调用方回调。
 *
 * 输入法组合守卫写在纯函数最前处(审查 C1):组合中(`nativeEvent.isComposing` 或
 * keyCode 229)一律返回未消费 —— 这里不 preventDefault,按键落回 textarea 自己处理
 * (上屏/Ctrl 组合都交给原生),与输入栏 `use-tag-complete` 同口径。
 */
import { useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { routeUnifiedKey } from './unified-keys';

export interface UnifiedKeyHandlers {
  /** 下拉是否真的在场(记录模式/实时筛选模式/浮层开着 -> 假,候选键全放行) */
  dropdownShown: boolean;
  activeIndex: number;
  /** 候选行数 */
  count: number;
  save: () => void;
  esc: () => void;
  highlight: (index: number) => void;
  accept: (index: number) => void;
}

export function useUnifiedKeys(h: UnifiedKeyHandlers) {
  return useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const action = routeUnifiedKey(
        { key: e.key, ctrlKey: e.ctrlKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode },
        { dropdownShown: h.dropdownShown, activeIndex: h.activeIndex, count: h.count },
      );
      if (action.type === 'ignore') return;
      e.preventDefault();
      if (action.type === 'save') h.save();
      else if (action.type === 'esc') h.esc();
      else if (action.type === 'highlight') h.highlight(action.index);
      else h.accept(action.index);
    },
    [h.dropdownShown, h.activeIndex, h.count, h.save, h.esc, h.highlight, h.accept],
  );
}
