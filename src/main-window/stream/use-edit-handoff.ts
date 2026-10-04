/**
 * 进编辑时的三件**一次性交接**(用户 2026-10-03 起陆续加的):
 *   ① 流的滚动位置 —— 面板比卡片高,浏览器滚动锚定会补偿性改 scrollTop,挂载后要写回;
 *   ② 光标偏移 —— 点正文时算出的源码位置,进编辑后光标落那里;
 *   ③ 点击的视口 y —— 面板一挂载顶部常在视口之上,要把光标拉回鼠标刚才的位置。
 * 对齐本身在**绘制之前**做完(useLayoutEffect + rAF),所以既不需要隐藏窗口,也不会看到拉扯。
 * 从 NoteStream 抽出:那一份顶着 200 行红线。
 */
import { useRef } from 'react';
import { scheduleCaretAlign } from './caret-restore';

type Scroller = { scrollTop: number } | null;

const defaultSchedule = (fn: () => void, ms: number): void => {
  if (ms === 0) requestAnimationFrame(fn);
  else window.setTimeout(fn, ms);
};

export interface EditHandoff {
  /** 开始一次进编辑交接(click 带光标偏移与点击屏幕 y;panel 切换两者都没有) */
  begin(scroller: Scroller, caret?: number | null, clickY?: number): void;
  /** 面板挂载后调用:做对齐并结束对齐窗口 */
  settle(scroller: Scroller): void;
  /** 交给 EditPanel 的光标偏移(一次性) */
  caretHint: number | null;
}

export function useEditHandoff(): EditHandoff {
  const scrollBefore = useRef<number | null>(null);
  const caretBefore = useRef<number | null>(null);
  const clickYBefore = useRef<number | null>(null);
  const started = useRef(false);

  const begin = (scroller: Scroller, caret?: number | null, clickY?: number): void => {
    scrollBefore.current = scroller?.scrollTop ?? null;
    caretBefore.current = caret ?? null;
    clickYBefore.current = clickY ?? null;
    started.current = true;
  };

  const settle = (scroller: Scroller): void => {
    const saved = scrollBefore.current;
    scrollBefore.current = null;
    const clickY = clickYBefore.current;
    clickYBefore.current = null;
    scheduleCaretAlign(scroller, saved, clickY, defaultSchedule);
  };

  return { begin, settle, caretHint: caretBefore.current };
}
