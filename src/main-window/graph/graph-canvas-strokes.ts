/**
 * 画布上的两层描边(自 `GraphCanvas.tsx` 分出,守 200 行红线):普通边层与关系边层。
 * 2026-10-06 边视觉重做后的口径:
 * - 父子(轴色)边:取父节点根轴色(段上 `color`)、**实线** 1.5px、基础 70%;弱化 25%
 * - 共现(弱关联)边:中性色**虚线(4/4)** 1px、基础 50%;弱化 15%
 * - 笔记链接边:accent **点线(1/4)** 1.5px;弱化 15%
 * - 标签关系边:accent 实线 1.5px + 终点箭头(与链接边同色同宽,箭头是唯一区别)
 *
 * 段自己的 `color` 优先于层默认色;`alpha` 是计划层给的显式读数(同轴边 100%),
 * 没给才退回「层基础值 / 层弱化值」。虚线/点线一律走 `setLineDash`,且**每层画完复位** ——
 * 不复位会漏到后面的点与文字上(常见坑)。
 */
import { DIM_ALPHA, EDGE_DIM_ALPHA, SOLID_DASH } from './graph-edge-style';
import type { Segment } from './graph-draw-plan-types';

/** 强调边(与焦点相连)的线宽:比同类型普通边明显粗一档(设计 §5「邻居边加粗」) */
const EMPHASIS_WIDTH = 2.5;
/** 关系边箭头:边长与缺省回收量(屏幕像素;实际回收量优先取 `Segment.pullback`) */
const ARROW_SIZE = 7;
const ARROW_PULLBACK = 10;

export interface StrokeOpts {
  /** 本层弱化后的不透明度(缺省 = `DIM_ALPHA`) */
  dimAlpha?: number;
  /** 本层线型:虚线/点线给间距数组,实线给 `SOLID_DASH`(空数组) */
  dash?: readonly number[];
}

export function strokeAll(
  ctx: CanvasRenderingContext2D,
  segs: readonly Segment[],
  color: string,
  /** 本层非强调边的线宽(共现 1 / 父子 1.5 / 链接 1.5) */
  baseWidth: number,
  /** 本层基础不透明度(没给 alpha 的段的落点) */
  baseAlpha = 1,
  opts: StrokeOpts = {},
): void {
  const dimAlpha = opts.dimAlpha ?? DIM_ALPHA;
  const dash = opts.dash ?? SOLID_DASH;
  let current = color;
  ctx.strokeStyle = color; // 空层也设一次:与既有「三层各取一次色」口径一致
  ctx.setLineDash([...dash]);
  for (const s of segs) {
    const want = s.color ?? color;
    if (want !== current) {
      ctx.strokeStyle = want;
      current = want;
    }
    ctx.lineWidth = s.emphasized ? EMPHASIS_WIDTH : baseWidth;
    // 强调边不被弱化压下去(加粗了还变淡反而看不清);同轴边的 100% 由计划层的 alpha 给
    ctx.globalAlpha = s.alpha ?? (s.dim && !s.emphasized ? dimAlpha : baseAlpha);
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
  }
  ctx.setLineDash([]); // 复位:虚线/点线不许漏到后面的点与文字上
}

/**
 * 关系边层:与 `strokeAll` 同一套粗细口径,但每条线在**终点**多画一个实心箭头 ——
 * 方向 = 「A 具有 B 所表示的属性」。回收量取 `pullback`(目标半径 + 余量),
 * 免得大节点/聚合圆的箭头整只落进圆里被点盖住。
 */
export function strokeRelations(
  ctx: CanvasRenderingContext2D,
  segs: readonly Segment[],
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.setLineDash([...SOLID_DASH]);
  for (const s of segs) {
    ctx.lineWidth = s.emphasized ? EMPHASIS_WIDTH : 1.5;
    ctx.globalAlpha = s.alpha ?? (s.dim && !s.emphasized ? EDGE_DIM_ALPHA : 1);
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
    if (!s.arrow) continue;
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy) || 1;
    const back = Math.min(s.pullback ?? ARROW_PULLBACK, len / 2);
    const tx = s.x2 - (dx / len) * back;
    const ty = s.y2 - (dy / len) * back;
    const ang = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - ARROW_SIZE * Math.cos(ang - 0.45), ty - ARROW_SIZE * Math.sin(ang - 0.45));
    ctx.lineTo(tx - ARROW_SIZE * Math.cos(ang + 0.45), ty - ARROW_SIZE * Math.sin(ang + 0.45));
    ctx.fill();
  }
  ctx.setLineDash([]);
}
