/**
 * 主窗侧的引导接线:自己再读一次 `ui.tutorial_seen` 决定挂不挂层,并给出三条出口。
 *
 * 为什么两边各读一次(设计风险表):只有输入栏负责**开窗**,只有主窗负责**渲染并写标记** ——
 * 输入栏读完即不再关心、一个字不写,所以两边同时判定"未看过"也不会重复触发或抢着写标记。
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { TUTORIAL_SEEN_KEY } from './steps';
import { isSeen } from './tutorial-model';

export interface TutorialEntry {
  /** 是否已经挂上引导(渲染门控由调用方 `open && <TutorialLayer/>` 做) */
  open: boolean;
  /** 用户动作结束(完成 / 跳过 / Esc):关层并写标记一次 */
  onExit: () => void;
  /** 重试后一步都显示不出来:只关层、**不写标记** —— 什么也没看到不算看过,下次启动再试 */
  onUnavailable: () => void;
  /** 设置页「重新观看」:先回信息流视图(锚点都在那里),再开层 */
  onReplay: () => void;
}

/** beforeReplay:重看前的视图归位(引导的锚点只在信息流视图上常态渲染,设计 D6) */
export function useTutorialEntry(beforeReplay: () => void): TutorialEntry {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void api
      .getSetting(TUTORIAL_SEEN_KEY)
      .then((v) => {
        if (alive && !isSeen(v)) setOpen(true);
      })
      .catch(() => {}); // 读设置失败不弹引导,主窗照常可用
    return () => {
      alive = false;
    };
  }, []);

  const onExit = useCallback(() => {
    setOpen(false);
    void api.setSetting(TUTORIAL_SEEN_KEY, '1').catch(() => {}); // 写失败也不卡住用户
  }, []);

  const onUnavailable = useCallback(() => setOpen(false), []);

  const onReplay = useCallback(() => {
    beforeReplay();
    setOpen(true);
  }, [beforeReplay]);

  return { open, onExit, onUnavailable, onReplay };
}
