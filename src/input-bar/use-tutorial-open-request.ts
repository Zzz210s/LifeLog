/**
 * 首次使用:未看过引导时把主窗叫起来(主窗是引导覆盖层的唯一承载界面,输入栏是独立贴纸窗)。
 *
 * 分工(设计 D4/D5 与风险表):**只有输入栏负责开窗**,**只有主窗负责渲染并写标记** ——
 * 所以这里读完标记就走,一个字都不写;写标记只能由用户动作(完成 / 跳过 / Esc)触发。
 */
import { useEffect } from 'react';
import { api } from '../shared/api';
import { TUTORIAL_SEEN_KEY } from '../main-window/tutorial/steps';
import { isSeen } from '../main-window/tutorial/tutorial-model';

export function useTutorialOpenRequest(): void {
  useEffect(() => {
    let alive = true;
    void api
      .getSetting(TUTORIAL_SEEN_KEY)
      .then((v) => {
        if (alive && !isSeen(v)) return api.openMainWindow();
      })
      .catch(() => {}); // 读设置/开窗失败不该影响输入栏可用(下次启动还会再试)
    return () => {
      alive = false;
    };
  }, []);
}
