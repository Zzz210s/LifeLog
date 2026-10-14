import { useCallback } from 'react';
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';
import { api } from '../shared/api';
import { cardEdgeBandCss, clampWidthFrom, edgeSide, GLOW_PAD, type Side } from '../shared/input-geometry';
import { pressKind } from '../shared/input-gestures';
import { currentRatio, readGeometry } from './logical-size';
import { windowHeightFor } from './use-auto-height';

/** 拖动期间最多 10 次/秒落尺寸,避免 IPC 与重排过密 */
const THROTTLE_MS = 100;

/**
 * 左右最外「可见卡片边缘带」(CSS 像素,cardEdgeBandCss=20):按下拖动改宽度(逻辑像素 240-900),
 * 高度按新换行重算。
 * 热区**不能**只用 8 逻辑像素的屏幕空间热区(edgeBandCss):可见卡片边缘在页面空间里恒在
 * GLOW_PAD(14 CSS px)处,与它只在缩放 ~0.57 时重合,缩放 >= 0.57 后用户抓可见边缘会落到
 * 「移动窗口」上(2026-10-14 装机版实测 zoom 1.0/2.0:抓可见边缘拖动,窗口被移动而宽度不变)。
 * 与上下带共用同一个带(见 input-geometry.cardEdgeBandCss),故 0.5-2.0 缩放下抓可见边缘
 * 一律判进本热区。edgeSide 仍按「CSS 像素 band」判定,换算在下面调用处完成。
 * **宽度拉伸不受「阻止移动」锁定影响**(用户 2026-09-11 决定):该锁定只拦窗口移动
 * (见 use-drag-band 的 locked),左右边缘始终可改宽度,此处故意不接收 locked。
 * 双击优先(detail >= 2 一律走双击动作,不进入宽度拖动)。
 * 返回 true 表示本次按下已被接管,调用方不再走「移动窗口」逻辑。
 */
export function useWidthDrag(opts: {
  textareaRef: { current: HTMLTextAreaElement | null };
  onDoubleClick: () => void;
}) {
  const { textareaRef, onDoubleClick } = opts;

  return useCallback(
    (e: React.MouseEvent): boolean => {
      if (e.button !== 0) return false;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      // 热区换算:可见卡片边缘带 -> CSS 像素(ratio 取自最近一次 readGeometry,同步可读)
      const side = edgeSide(e.clientX - rect.left, rect.width, cardEdgeBandCss(currentRatio()));
      if (!side) return false;
      if (pressKind(e.detail) === 'double') {
        e.preventDefault();
        onDoubleClick();
        return true;
      }
      const ta = textareaRef.current;
      if (!ta) return true;
      e.preventDefault();
      void startWidthDrag(side, e.screenX, ta);
      return true;
    },
    [onDoubleClick, textareaRef],
  );
}

async function startWidthDrag(
  side: Side,
  startScreenX: number,
  ta: HTMLTextAreaElement,
): Promise<void> {
  const geo = await readGeometry();
  if (!geo) return;
  const { ratio, scale, x, y, width: startWidth } = geo;
  let lastScreenX = startScreenX;
  let lastAt = 0;

  // 宽度与高度一次算好一起落:宽度改变会改变换行行数,高度必须同时跟上。
  // 位移必须用 screenX:它按系统缩放换算(physical / scale),数值上就是窗口逻辑像素,
  // 不受 webview 页面 zoom 影响;而 clientX 是页面 CSS 像素,左边缘拖动时窗口原点会跟着
  // 移动,同一个位移会被自身抵消一半(实测拖 100 像素只生效 50)。
  const apply = (screenX: number) => {
    const delta = (side === 'left' ? -1 : 1) * (screenX - startScreenX);
    // 基线可能在 240-900 之外(缩放路径只按工作区 80% 收口),clampWidthFrom 会把区间抬到基线,
    // 否则鼠标一动宽度就跳到区间边界(实测 zoom 2.0 拖进 20 物理像素、宽度从 1536 跳到 1125)。
    const width = clampWidthFrom(startWidth, startWidth + delta);
    // windowHeightFor 的 cssWidth 参数是**输入框**的 border-box 宽度,
    // 而这里是**窗口**的 CSS 宽度:窗口根节点有 p-[14px] 且 Tailwind preflight 为 border-box,
    // 输入框比窗口窄 2 x GLOW_PAD。不减掉就会按偏宽的宽度测量换行、少算一行,
    // 窗口变矮、滚动条提前出现(拖动路径专用;自动高度路径传的是实测宽度,不受影响)。
    // 返回值是基础逻辑高度(缩放无关),与 setInputSize 的高度入参同一单位。
    const height = windowHeightFor(ta, width / ratio - 2 * GLOW_PAD);
    void api.setInputSize(width, height).catch(() => {});
    if (side === 'left') {
      // 左边缘:窗口左边界跟手(宽度减多少,位置就右移多少)
      const dx = Math.round((startWidth - width) * scale);
      void getCurrentWindow()
        .setPosition(new PhysicalPosition(x + dx, y))
        .catch(() => {});
    }
  };

  const onMove = (ev: MouseEvent) => {
    // 主键已松开(mouseup 在甩动/指针出窗时可能丢失):立刻收尾,避免拖动会话残留
    if ((ev.buttons & 1) === 0) {
      onUp();
      return;
    }
    lastScreenX = ev.screenX;
    const now = performance.now();
    if (now - lastAt < THROTTLE_MS) return;
    lastAt = now;
    apply(lastScreenX);
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    apply(lastScreenX); // 收尾:节流可能吞掉最后一次移动
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
