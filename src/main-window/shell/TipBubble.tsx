/**
 * 气泡外观(纯展示件):从 `HoverTip` 抽出,标签悬浮提示与关系图画布气泡两处共用。
 *
 * 契约:`x/y` 是**屏幕(视口)坐标**上的锚点,`above` 决定气泡挂在锚点上方还是下方
 * (`fixed` 定位,故坐标一律按视口算)。类名与 DOM 结构与 `HoverTip` 抽取前逐字一致
 * (`data-testid="hover-tip"`),既有用例继续当"抽取没改行为"的证据。
 * `pointer-events-none`:气泡不吃鼠标,压住画布也不影响命中检测。
 */
import type { ReactNode } from 'react';

/** 锚点与气泡之间的空隙;HoverTip 算贴边夹取时也要用同一个数,故导出 */
export const TIP_GAP = 6;

export function TipBubble(p: {
  text: string;
  x: number;
  y: number;
  /** 挂在锚点上方(默认下方):下方空间不够时翻上去 */
  above?: boolean;
}): ReactNode {
  const style =
    p.above === true
      ? { left: p.x, bottom: window.innerHeight - p.y + TIP_GAP }
      : { left: p.x, top: p.y + TIP_GAP };
  return (
    <div
      data-testid="hover-tip"
      className="pointer-events-none fixed z-50 max-w-[16rem] -translate-x-1/2 whitespace-pre-line rounded-md border border-border bg-raised px-2 py-1 text-xs break-words text-text shadow-lg"
      style={style}
    >
      {p.text}
    </div>
  );
}
