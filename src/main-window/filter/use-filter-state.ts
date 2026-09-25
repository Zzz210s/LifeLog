/**
 * 单份筛选条件的状态与持久化(spec 2026-09-25 §2/§3):settings 键 `filter_current`。
 * 行为口径沿用旧标签页状态层(design 2026-09-25 §3 的“同一子集”),只是从"多页"变"单份":
 * - 启动读回:键缺失/损坏 -> 默认空条件(parseFilterState 兜底)
 * - 变更节流 500ms 写回;卸载补写未落盘改动;恢复完成前不写回(免得用默认值覆盖已存状态)
 * - reload():标签改名/移动后从库重读 —— Rust 在同一事务里已改写该键,前端不重复实现
 *   一套重写(两份口径必然漂移);键缺失时保持当前状态不动
 * 与旧版的一处收敛:库值与当前值相等时不换对象,所以启动/重读不会把同一个值再写回去
 * (键缺失退化为默认空条件时也照此,不留一次无谓的写库)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { filterKey } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import {
  FILTER_KEY,
  defaultFilterState,
  parseFilterState,
  serializeFilterState,
  toggleFilterTag,
} from './filter-state';

/** 状态变化到写库的节流窗口(合并连续输入/连点) */
const WRITE_DELAY_MS = 500;

export interface FilterStateApi {
  /** 当前筛选条件(查询/条件栏/侧栏选中态都从它派生) */
  conditions: FilterConditions;
  patch: (value: Partial<FilterConditions>) => void;
  toggleTag: (path: string) => void;
  /** 标签改名/移动后从库重读(Rust 已在同一事务里改写该键) */
  reload: () => void;
}

/** 值没变就不换对象(避免把刚读回的同一个值再写回去) */
const replaceIfChanged = (
  cur: FilterConditions,
  next: FilterConditions
): FilterConditions => (filterKey(cur) === filterKey(next) ? cur : next);

export function useFilterState(): FilterStateApi {
  const [conditions, setConditions] = useState<FilterConditions>(defaultFilterState);
  const ready = useRef(false); // 恢复完成前不写回
  const latest = useRef(conditions);
  latest.current = conditions;
  const timer = useRef<number | null>(null);

  useEffect(() => {
    void api
      .getSetting(FILTER_KEY)
      .then((raw) => {
        setConditions((cur) => replaceIfChanged(cur, parseFilterState(raw)));
        ready.current = true; // 读回落地即放行(渲染可能先于 finally 那个微任务)
      })
      .catch(() => {
        ready.current = true; // 读取失败回落默认空条件,不阻断主界面
      });
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void api.setSetting(FILTER_KEY, serializeFilterState(latest.current)).catch(() => {
        /* 写失败不影响本次会话的筛选条件 */
      });
    }, WRITE_DELAY_MS);
  }, [conditions]);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
        void api.setSetting(FILTER_KEY, serializeFilterState(latest.current)).catch(() => {});
      }
    },
    []
  );

  /**
   * 从库重读(标签改名/移动后 Rust 已在同一事务里改写该键,前端不重复实现重写)。
   *
   * 已知窗口(继承自旧标签页版的 reload,非本层引入):reload 期间 `ready=false` 且挂起的写回被清掉,
   * 若用户在 IPC 往返窗口内改条件,那次改动既不落盘也不再排程(键缺失路径下更明显)。
   * 触发面:`use-edit-flow` 在标签路径变更时调它,可能与用户 500ms 内的点选重叠。
   */
  const reload = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current); // 取消待写的旧值,别覆盖 Rust 刚改写的结果
      timer.current = null;
    }
    ready.current = false;
    void api
      .getSetting(FILTER_KEY)
      .then((raw) => {
        if (raw !== null) setConditions((cur) => replaceIfChanged(cur, parseFilterState(raw)));
        ready.current = true; // 同上:先放行,免得替换后的渲染落在 finally 之前
      })
      .catch(() => {
        ready.current = true; // 读失败:保留当前状态
      });
  }, []);

  const patch = useCallback((value: Partial<FilterConditions>) => {
    setConditions((c) => ({ ...c, ...value }));
  }, []);

  const toggleTag = useCallback((path: string) => {
    setConditions((c) => toggleFilterTag(c, path));
  }, []);

  return { conditions, patch, toggleTag, reload };
}
