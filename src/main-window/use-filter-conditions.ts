import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../shared/api';
import { EMPTY_FILTER } from '../shared/filter-conditions';
import { hasLegacyDateKeys, parseFilterJson } from '../shared/filter-conditions-parse';
import type { FilterConditions } from '../shared/filter-conditions';

/** 上次使用的筛选条件(JSON 文本);读取失败或非法一律回退默认 */
const SETTING_KEY = 'filter_last';
/** 条件变化到写库的节流窗口(合并连续输入/连点) */
const WRITE_DELAY_MS = 500;

/** 主窗筛选条件状态与两个原子操作(状态由主窗顶层单一对象承载,D7) */
export interface FilterConditionsApi {
  conditions: FilterConditions;
  /** 局部更新(浅合并):关键词、排序、有无标签等单字段变更 */
  patch: (value: Partial<FilterConditions>) => void;
  /** 标签选中开关:未选中则加入(默认"含子级"),已选中则移除 */
  toggleTag: (path: string) => void;
}

/**
 * 主窗筛选条件状态 + `filter_last` 持久化:
 * - 启动读回上次条件(非法 JSON 回退 EMPTY_FILTER);带已取消日期字段(from/to)的旧值
 *   归一后回写一次,免得旧键长期留在库里
 * - 条件变化节流 500ms 写回;卸载时补写未落盘的改动
 * - 恢复完成前不写回,避免用默认值覆盖已存条件
 */
export function useFilterConditions(): FilterConditionsApi {
  const [conditions, setConditions] = useState<FilterConditions>(EMPTY_FILTER);
  const ready = useRef(false);
  const latest = useRef(conditions);
  latest.current = conditions;
  const timer = useRef<number | null>(null);

  useEffect(() => {
    void api
      .getSetting(SETTING_KEY)
      .then((raw) => {
        const parsed = parseFilterJson(raw);
        setConditions(parsed);
        // 旧值里残留 from/to(迁移 011 只清了 saved_views):归一后回写一次
        if (hasLegacyDateKeys(raw)) {
          void api.setSetting(SETTING_KEY, JSON.stringify(parsed)).catch(() => {});
        }
      })
      .catch(() => {
        /* 读取失败回落默认条件,不阻断主界面 */
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
      void api.setSetting(SETTING_KEY, JSON.stringify(latest.current)).catch(() => {
        /* 写失败不影响本次会话的筛选 */
      });
    }, WRITE_DELAY_MS);
  }, [conditions]);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
        void api.setSetting(SETTING_KEY, JSON.stringify(latest.current)).catch(() => {});
      }
    },
    []
  );

  const patch = useCallback((value: Partial<FilterConditions>) => {
    setConditions((prev) => ({ ...prev, ...value }));
  }, []);

  const toggleTag = useCallback((path: string) => {
    setConditions((prev) => {
      const has = prev.tags.some((t) => t.path === path);
      const tags = has
        ? prev.tags.filter((t) => t.path !== path)
        : [...prev.tags, { path, includeChildren: true }];
      return { ...prev, tags };
    });
  }, []);

  return { conditions, patch, toggleTag };
}
