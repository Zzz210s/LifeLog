/**
 * 统一输入框模式/query 的镜像 + `/` 实时筛选防抖(自 StreamView 抽出以守行数红线)。
 * `onPatch` 用 ref 现读:防抖定时器可能在很久以后才跑,不能闭包住旧 props。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { InputMode } from '../../shared/input-prefix';

/** `/` 实时筛选的防抖窗口(与旧 FilterBar 同口径) */
export const FILTER_DEBOUNCE_MS = 300;

export interface UnifiedFilterSync {
  /** 当前模式:提示行与采纳决策都从这里取 */
  mode: InputMode;
  /** 交给统一输入框的 onStateChange(模式/query 每次变化都被调) */
  onStateChange: (s: { mode: InputMode; query: string }) => void;
}

export function useUnifiedFilterSync(
  onPatch: (value: Partial<FilterConditions>) => void,
): UnifiedFilterSync {
  // 去重:同一对值不换对象,免得每次重渲染都把信息流带着重画
  const [u, setU] = useState<{ mode: InputMode; query: string }>({ mode: 'note', query: '' });
  const timer = useRef<number | null>(null);
  const patch = useRef(onPatch);
  patch.current = onPatch;

  const onStateChange = useCallback((s: { mode: InputMode; query: string }) => {
    setU((prev) => (prev.mode === s.mode && prev.query === s.query ? prev : s));
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    // 离开筛选模式就取消挂起的那次:已写进去的关键词留在 chip 上,可单独删
    if (s.mode !== 'filter') return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      patch.current({ keyword: s.query });
    }, FILTER_DEBOUNCE_MS);
  }, []);

  // 卸载清理:切设置页/关窗时不留一个还会写条件的定时器
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  return { mode: u.mode, onStateChange };
}
