/**
 * 画布上的两层描边(自 `GraphCanvas.tsx` 分出,守 200 行红线):普通边层与关系边层。
 * 两者同一套粗细/透明度口径 —— 共现边最弱、父子边居中、链接/关系边 accent;
 * 关系边是唯一在**终点画实心箭头**的一层,箭头尖按 `Segment.pullback`(目标半径 + 余量)回收。
 * 颜色一律由调用方从主题令牌读出传入,这里零硬编码色值。
 */
import type { Segment } from './graph-draw-plan-types';

/** 弱化透明度:足够暗到让焦点跳出来,又还能看出图的结构 */
export const DIM_ALPHA = 0.2;
/** 共现边的基础不透明度(设计 D5:最弱一档,压到父子边之下) */
export const CO_ALPHA = 0.6;
/** 强调边(与焦点相连)的线宽:比同类型普通边明显粗一档(设计 §5「邻居边加粗」) */
const EMPHASIS_WIDTH = 2.5;
/** 关系边箭头:边长与缺省回收量(屏幕像素;实际回收量优先取 `Segment.pullback`) */
const ARROW_SIZE = 7;
const ARROW_PULLBACK = 10;

export function strokeAll(
  ctx: CanvasRenderingContext2D,
  segs: readonly Segment[],
  color: string,
  /** 本层非强调边的线宽(共现 1 / 父子 1.5) */
  baseWidth: number,
  /**
   * 本层基础不透明度(设计 D5 边三档):共现边压到 60% 让它在父子边之下,
   * 层次靠"粗细 + 透明度"两层表达,而不是只靠颜色深浅。
   */
  baseAlpha = 1,
): void {
  ctx.strokeStyle = color;
  for (const s of segs) {
    ctx.lineWidth = s.emphasized ? EMPHASIS_WIDTH : baseWidth;
    // 强调边一律满不透明:焦点那一头即使是无关节点(边 dim),加粗了还变淡反而看不清
    ctx.globalAlpha = s.dim && !s.emphasized ? DIM_ALPHA : baseAlpha;
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
  }
  // 这里不归位:每段自己设 alpha,而边之后的绘制对象统一由点循环后的归位接住(见 GraphCanvas)
}

/**
 * 关系边层:与 `strokeAll` 同一套粗细/透明度口径,但每条线在**终点**多画一个实心箭头 ——
 * 这是它与同色同宽的笔记链接边唯一的区别(方向 = 「A 具有 B 所表示的属性」)。
 * 回收量取 `pullback`(目标半径 + 余量),免得大节点/聚合圆的箭头整只落进圆里被点盖住。
 */
export function strokeRelations(
  ctx: CanvasRenderingContext2D,
  segs: readonly Segment[],
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const s of segs) {
    ctx.lineWidth = s.emphasized ? EMPHASIS_WIDTH : 1.5;
    ctx.globalAlpha = s.dim && !s.emphasized ? DIM_ALPHA : 1;
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
}
