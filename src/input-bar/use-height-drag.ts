import { useCallback } from 'react';
import { currentMonitor } from '@tauri-apps/api/window';
import {
  WORK_AREA_RATIO,
  cardEdgeBandCss,
  clampMinHeightFrom,
  inBottomBand,
  minHeightHi,
  minHeightLo,
} from '../shared/input-geometry';
import { pressKind } from '../shared/input-gestures';
import { currentRatio, readGeometry } from './logical-size';
import { chromeHeightCss, lineHeightCss } from './use-auto-height';

/** 拖动期间最多 10 次/秒同步下限(窗口由 use-auto-height 用 max(自动,下限) 落),避免重排与 IPC 过密 */
const THROTTLE_MS = 100;
/** 位移死区(屏幕逻辑像素):底边重按一下不该把「当前窗口高」固化成下限(建议列表会把窗口顶到 360) */
const DEAD_ZONE = 3;

/**
 * 底边最外「可见卡片边缘带」(CSS 像素,cardEdgeBandCss=20):按下拖动改**最小高度下限**
 * (基础逻辑像素,1 行 .. min(12 行, 工作区 80%))。
 *
 * 下限只影响「内容比它矮」的时候:窗口高度 = max(自动高度, 下限) —— 内容更长时照常随内容长高。
 * 拖动期间只改本地态(**不落库**),窗口由 use-auto-height 用不写 input_h 的 overlay 命令落;
 * 松手才写一次 input_min_h(与「几何只按用户意图写回」同一条纪律)。
 * 双击底边 = 复位到纯自动(写 0)。
 *
 * 与左右带(改宽)、顶边带(移动窗口)共用同一个带:路由里左右带排在最前、本带排在
 * 「移动窗口」之前(见 use-root-mouse),故角上按宽度、底边按高度,移动仍有顶边带与
 * 卡片内侧那条带两条路。
 * **不受「阻止移动」锁定影响**(与左右拉宽同一条规矩):该锁定只拦窗口移动。
 * 返回 true 表示本次按下已被接管,调用方不再走「移动窗口」逻辑。
 */
export function useHeightDrag(opts: {
  textareaRef: { current: HTMLTextAreaElement | null };
  applyMin: (h: number) => void;
  commitMin: (h: number) => void;
}): (e: React.MouseEvent) => boolean {
  const { textareaRef, applyMin, commitMin } = opts;
  return useCallback(
    (e: React.MouseEvent): boolean => {
      if (e.button !== 0) return false;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      if (!inBottomBand(e.clientY - rect.top, rect.height, cardEdgeBandCss(currentRatio()))) return false;
      if (pressKind(e.detail) === 'double') {
        e.preventDefault();
        applyMin(0);
        commitMin(0); // 复位到纯自动
        return true;
      }
      const ta = textareaRef.current;
      if (!ta) return true;
      e.preventDefault();
      void startHeightDrag(e.screenY, ta, applyMin, commitMin);
      return true;
    },
    [applyMin, commitMin, textareaRef],
  );
}

/** 底边拖动:下限跟手,松手写库一次 */
async function startHeightDrag(
  startScreenY: number,
  ta: HTMLTextAreaElement,
  applyMin: (h: number) => void,
  commitMin: (h: number) => void,
): Promise<void> {
  const geo = await readGeometry();
  if (!geo) return;
  const { ratio, scale } = geo;
  const line = lineHeightCss(ta);
  const chrome = chromeHeightCss(ta);
  const lo = minHeightLo(line, chrome);
  const hi = minHeightHi(line, chrome, await workAreaCapBaseLogical(scale, ratio));
  // 基线 = 按下那一刻的窗口高换算回**基础逻辑像素**(物理 / (系统缩放 x webview 缩放) = 逻辑高 / ratio):
  // 拖底边就要让窗口底边跟手,基线取当前实际高度(与宽度拖动取当前逻辑宽同理)。
  const base = geo.height / ratio;
  let lastScreenY = startScreenY;
  let lastMin = 0;
  let lastAt = 0;
  let moved = false;

  // 位移必须用 screenY:它按系统缩放换算(physical / scale),不受 webview 页面 zoom 影响;
  // 而高度入参是**基础逻辑像素**(缩放 1 时的逻辑像素),故位移还要除以 webview 缩放 ratio
  // (zoom 2.0 下拖 40 屏幕像素 = 20 基础逻辑像素;不除就是 2 倍跟手)。
  const apply = (screenY: number) => {
    lastMin = clampMinHeightFrom(base, base + (screenY - startScreenY) / ratio, lo, hi);
    applyMin(lastMin);
  };

  const onMove = (ev: MouseEvent) => {
    // 主键已松开(mouseup 在甩动/指针出窗时可能丢失):立刻收尾,避免拖动会话残留
    if ((ev.buttons & 1) === 0) {
      onUp();
      return;
    }
    if (Math.abs(ev.screenY - startScreenY) > DEAD_ZONE) moved = true;
    lastScreenY = ev.screenY;
    const now = performance.now();
    if (now - lastAt < THROTTLE_MS) return;
    lastAt = now;
    if (moved) apply(lastScreenY);
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (!moved) return; // 只按了一下:不改下限也不写库
    apply(lastScreenY); // 收尾:节流可能吞掉最后一次移动
    commitMin(lastMin);
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

/**
 * 当前显示器工作区高度按 80% 收口后换算成**基础逻辑像素**上限:
 * 物理 = 基础逻辑 x 系统缩放 x webview 缩放(见 Rust input_height::height_phys),故除回去。
 * 取不到显示器/换算系数非法时返回 Infinity(不收口,仍受 12 行上限约束)。
 */
async function workAreaCapBaseLogical(scale: number, zoom: number): Promise<number> {
  try {
    const mon = await currentMonitor();
    const f = scale * zoom;
    if (!mon || !Number.isFinite(f) || f <= 0) return Number.POSITIVE_INFINITY;
    return (mon.workArea.size.height * WORK_AREA_RATIO) / f;
  } catch {
    return Number.POSITIVE_INFINITY; // 取不到工作区不阻断拖动
  }
}
