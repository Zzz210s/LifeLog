import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../shared/api';
import { parseMinHeight } from '../shared/input-geometry';

/** 最小高度下限的设置键(基础逻辑像素;缺省 = 0 = 纯自动 = 现状) */
const MIN_H_KEY = 'input_min_h';

/**
 * 输入栏「最小高度」下限的本地态与落库(拖底边设置,见 use-height-drag)。
 *
 * 与 input_h 分开存:input_h 是**内容高度**的记忆(自动高度路径的意图),下限是另一种意图 ——
 * 合到一个键里,清掉下限后窗口会停在一条悬空的空高条上。
 * 拖动期间只改本地态(窗口由 use-auto-height 用 max(自动,下限) 落,**松手才写一次库**);
 * 读不到(首装)或读到非法值一律按 0(纯自动),读库返回期间用户若已开始拖动则不覆盖。
 */
export function useMinHeight(): {
  minHeight: number;
  applyMin: (h: number) => void;
  commitMin: (h: number) => void;
} {
  const [minHeight, setMinHeight] = useState(0);
  /** 本次会话内是否已被拖动/复位改过:读了库再覆盖回去会把用户刚调好的下限弹回去 */
  const touched = useRef(false);

  useEffect(() => {
    let alive = true;
    void api
      .getSetting(MIN_H_KEY)
      .then((raw) => {
        if (alive && !touched.current) setMinHeight(parseMinHeight(raw));
      })
      .catch(() => {}); // 读不到:按纯自动,不阻断输入栏
    return () => {
      alive = false;
    };
  }, []);

  const applyMin = useCallback((h: number) => {
    touched.current = true;
    setMinHeight(Number.isFinite(h) && h > 0 ? Math.round(h) : 0);
  }, []);

  const commitMin = useCallback((h: number) => {
    touched.current = true;
    const value = Number.isFinite(h) && h > 0 ? Math.round(h) : 0;
    void api.setSetting(MIN_H_KEY, String(value)).catch(() => {}); // 写库失败只影响下次启动的还原
  }, []);

  return { minHeight, applyMin, commitMin };
}
