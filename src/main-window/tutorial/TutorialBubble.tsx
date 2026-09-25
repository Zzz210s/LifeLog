/**
 * 引导气泡:步序 + 标题 + 正文 + 「跳过 / 下一步(末步为「完成」)」。
 *
 * 位置由 placeBubble(纯几何,Task 1 已单测)从洞口算出:优先洞口下方居中,下方不够翻到上方,
 * 左右钳在视口内。placeBubble 需要气泡高度才能判断下方够不够,所以这里自己量一下自己
 * (offsetHeight + self ResizeObserver;jsdom 里量到 0,几何断言在 Task 1 的单测里)。
 * 样式零硬编码:圆角 / 边框 / 阴影 / 字号 / 颜色全部取 theme.css 令牌。
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { BTN_PRIMARY, BTN_TEXT } from '../shell/button-classes';
import { placeBubble } from './tutorial-layout';
import type { Rect } from './tutorial-layout';
import type { TutorialStep } from './steps';

/** 气泡宽度(与类名 w-80 同值;placeBubble 要数字) */
const BUBBLE_WIDTH = 320;
/** 还没量到洞口时气泡的落点(贴视口上方居中,不挡顶栏) */
const FALLBACK_TOP = 24;

export interface TutorialBubbleProps {
  step: TutorialStep;
  /** 当前步序号(0 起) */
  index: number;
  /** 总步数 */
  total: number;
  /** 当前洞口(null = 还没量到) */
  hole: Rect | null;
  onNext: () => void;
  onSkip: () => void;
  /** 层持有它做焦点锁(Tab 循环 + 焦点拉回) */
  bubbleRef?: RefObject<HTMLDivElement | null>;
}

export function TutorialBubble(p: TutorialBubbleProps): ReactNode {
  const titleId = useId();
  const own = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  const { bubbleRef } = p;

  /** 自己量自己:合并层的焦点 ref 与本地高度测量用 ref(层给的身份稳定,回调 ref 不抖动) */
  const attach = useCallback(
    (el: HTMLDivElement | null): void => {
      own.current = el;
      if (bubbleRef) bubbleRef.current = el;
    },
    [bubbleRef]
  );

  useEffect(() => {
    const el = own.current;
    if (el === null) return;
    const read = (): void => setHeight((h) => (el.offsetHeight === h ? h : el.offsetHeight));
    read();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(read);
      ro.observe(el);
    }
    return () => ro?.disconnect();
  }, [p.step]);

  const last = p.index + 1 >= p.total;
  const pos =
    p.hole === null
      ? { top: FALLBACK_TOP, left: Math.max(8, Math.round((window.innerWidth - BUBBLE_WIDTH) / 2)) }
      : placeBubble(p.hole, { width: BUBBLE_WIDTH, height }, { width: window.innerWidth, height: window.innerHeight });

  return (
    <div
      ref={attach}
      data-testid="tutorial-bubble"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="absolute z-50 w-80 rounded-lg border border-border bg-raised p-4 text-text shadow-lg outline-none"
      style={{ top: pos.top, left: pos.left }}
    >
      <p data-testid="tutorial-step" className="text-label text-muted">
        第 {p.index + 1} / {p.total} 步
      </p>
      <h2 id={titleId} className="mt-1 text-title">
        {p.step.title}
      </h2>
      <p className="mt-2 text-body-sm text-muted">{p.step.body}</p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" data-testid="tutorial-skip" className={BTN_TEXT + ' text-muted'} onClick={p.onSkip}>
          跳过
        </button>
        <button type="button" data-testid="tutorial-next" className={BTN_PRIMARY} onClick={p.onNext}>
          {last ? '完成' : '下一步'}
        </button>
      </div>
    </div>
  );
}
