/**
 * 新手引导期间临时收起输入栏(设计 §7 的层叠风险根治)。
 *
 * 为什么:输入栏是 `alwaysOnTop` 的贴纸窗,与主窗同屏时永远压在上面 —— 用户把它停在屏幕中部时
 * 会盖住引导气泡(实测 2026-09-26)。引导是模态的、只讲主窗,所以这段时间把它收起来最干净。
 *
 * 口径:
 * - 开引导时**先问系统实际可见性**(`input_bar_visible`,不信前端缓存 —— 缓存失同步是踩过的坑);
 *   可见才收起,不可见就什么都不做;
 * - 引导结束(或组件卸载)时**按原状恢复**:原本可见才重新显示;
 * - 读可见性/收起/恢复失败都静默(引导与输入栏都不该因此不可用)。
 */
import { useEffect, useRef } from 'react';
import { api } from '../../shared/api';

export function useTutorialInputBar(open: boolean): void {
  /** 引导开始前输入栏是否可见(只在本次引导内有效) */
  const wasVisible = useRef(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void api
      .inputBarVisible()
      .then((visible) => {
        if (!alive) return;
        wasVisible.current = visible;
        if (visible) return api.hideInputBar();
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (!wasVisible.current) return;
      wasVisible.current = false;
      void api.showInputWindow().catch(() => {});
    };
  }, [open]);
}
