/**
 * 标签页状态与持久化(spec 2026-09-17 S7):settings 键 `tabs_state`。
 * 与旧 filter_last 的差别:条件挂在"每个标签页"上,当前活动页的条件就是唯一真源
 * (库里不再并行维护两套状态;filter_last 已由迁移 014 删除)。
 * - 启动读回:键缺失/损坏 -> 单个「全部」页(parseTabsState 兜底)
 * - 变更节流 500ms 写回;卸载补写未落盘改动;恢复完成前不写回(免得用默认值覆盖已存状态)
 * - reload():标签改名/移动后从库重读 —— Rust 在同一事务里已重写各页条件里的路径,
 *   前端不重复实现一套重写(两份口径必然漂移);键缺失时保持当前状态不动
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { PresetKey } from './tab-presets';
import { presetByKey } from './tab-presets';
import {
  TABS_KEY,
  activateTab,
  activeConditions,
  addTab,
  closeTab,
  defaultTabs,
  findTab,
  moveTab,
  parseTabsState,
  patchActive,
  renameTab,
  serializeTabsState,
  toggleActiveTag,
} from './tabs-model';
import type { Tab, TabsState } from './tabs-model';

/** 状态变化到写库的节流窗口(合并连续输入/连点) */
const WRITE_DELAY_MS = 500;

export interface TabsApi {
  tabs: Tab[];
  activeIndex: number;
  /** 当前活动页的条件(查询/筛选栏/侧栏选中态都从它派生) */
  conditions: FilterConditions;
  activate: (index: number) => void;
  /** 预设:已有同条件的页就切过去,否则追加一页 */
  addPreset: (key: PresetKey) => void;
  /** 把当前筛选开成新标签页(总是追加,便于在原页基础上改条件) */
  addFromCurrent: () => void;
  close: (index: number) => void;
  move: (from: number, to: number) => void;
  rename: (index: number, title: string) => void;
  patch: (value: Partial<FilterConditions>) => void;
  toggleTag: (path: string) => void;
  reload: () => void;
}

export function useTabs(): TabsApi {
  const [state, setState] = useState<TabsState>(defaultTabs);
  const ready = useRef(false); // 恢复完成前不写回
  const latest = useRef(state);
  latest.current = state;
  const timer = useRef<number | null>(null);

  useEffect(() => {
    void api
      .getSetting(TABS_KEY)
      .then((raw) => setState(parseTabsState(raw)))
      .catch(() => {
        /* 读取失败回落单个「全部」页,不阻断主界面 */
      })
      .finally(() => {
        ready.current = true;
      });
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void api.setSetting(TABS_KEY, serializeTabsState(latest.current)).catch(() => {
        /* 写失败不影响本次会话的标签页 */
      });
    }, WRITE_DELAY_MS);
  }, [state]);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
        void api.setSetting(TABS_KEY, serializeTabsState(latest.current)).catch(() => {});
      }
    },
    []
  );

  const reload = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current); // 取消待写的旧值,别覆盖 Rust 刚重写的结果
      timer.current = null;
    }
    ready.current = false;
    void api
      .getSetting(TABS_KEY)
      .then((raw) => {
        if (raw !== null) setState(parseTabsState(raw));
      })
      .catch(() => {
        /* 读失败:保留当前状态 */
      })
      .finally(() => {
        ready.current = true;
      });
  }, []);

  return {
    tabs: state.tabs,
    activeIndex: state.activeIndex,
    conditions: activeConditions(state),
    activate: (index) => setState((s) => activateTab(s, index)),
    addPreset: (key) =>
      setState((s) => {
        const conditions = presetByKey(key).conditions;
        const existing = findTab(s, conditions);
        return existing >= 0 ? activateTab(s, existing) : addTab(s, conditions);
      }),
    addFromCurrent: () => setState((s) => addTab(s, activeConditions(s))),
    close: (index) => setState((s) => closeTab(s, index)),
    move: (from, to) => setState((s) => moveTab(s, from, to)),
    rename: (index, title) => setState((s) => renameTab(s, index, title)),
    patch: (value) => setState((s) => patchActive(s, value)),
    toggleTag: (path) => setState((s) => toggleActiveTag(s, path)),
    reload,
  };
}
