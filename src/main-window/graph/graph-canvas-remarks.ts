/**
 * 关系备注的底衬胶囊与文字(自 `GraphCanvas` 分出,守 200 行红线;2026-10-06 性能轮):
 * 每条备注先垫一层 raised 底 + border 描边的圆角矩形再写字 —— 否则 12px muted 字直接压在
 * 同字体同色的标签堆上肉眼读不出。三处逐帧浪费在这里收掉:
 *
 * - **字宽按 (画布上下文, 字体, 文字) 缓存**:`measureText` 是每条备注每帧都要问一次的活,
 *   而备注文本来自库里的属性名,几乎不变 —— 同一句话量一次就够。缓存挂在上下文对象上
 *   (WeakMap):画布上下文的身份稳定,跨帧命中;测试里的上下文替身各自独立,互不串味。
 * - **令牌每帧只读一次**:底衬/描边/文字三个色此前是**每条备注各读一遍**(每次都是
 *   `getComputedStyle`),24 条备注 = 72 次;现在一次读完。
 * - **同值赋值跳过**:`strokeStyle` 每条备注都是同一个值(此前写 24 次,现在 1 次),
 *   `lineWidth` 同理;`fillStyle` 不得跳 —— 底衬色与文字色逐条交替是**绘制顺序**要求的
 *   (见下方循环里的注释),改了就是改 z 序。
 *
 * 绘制顺序与像素口径完全不变:逐条画(底衬 -> 描边 -> 文字),该弱化的照旧弱化。
 */
import { DIM_ALPHA } from './graph-edge-style';
import type { RelationMark } from './graph-draw-plan-types';
import { token } from './token';

/** 底衬胶囊:左右内边距 / 高度 / 圆角(屏幕像素) */
const REMARK_PAD_X = 4;
const REMARK_H = 16;
const REMARK_RADIUS = 4;

const widthCache = new WeakMap<CanvasRenderingContext2D, Map<string, number>>();

/** 字宽读数:按 (ctx, 当前字体, 文字) 缓存 */
export function remarkWidth(ctx: CanvasRenderingContext2D, text: string): number {
  let byKey = widthCache.get(ctx);
  if (byKey === undefined) {
    byKey = new Map();
    widthCache.set(ctx, byKey);
  }
  // 字体放进键里:同一条备注在不同字号下宽度不同(当前恒 12px,但口径不靠"当前恒")
  const key = `${ctx.font}\u0000${text}`;
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;
  const width = ctx.measureText(text).width;
  byKey.set(key, width);
  return width;
}

/**
 * 画备注层(`k >= 阈值` 时绘制计划才给 marks)。空层直接返回、**不碰令牌** ——
 * 没备注时不该在画布上多记一笔设色(既有用例钉着这条)。
 */
export function drawRelationMarks(ctx: CanvasRenderingContext2D, marks: readonly RelationMark[]): void {
  if (marks.length === 0) return;
  ctx.textBaseline = 'middle';
  const raised = token('--color-raised');
  const border = token('--color-border');
  const muted = token('--color-muted');
  let stroke = '';
  ctx.lineWidth = 1;
  for (const m of marks) {
    ctx.globalAlpha = m.dim ? DIM_ALPHA : 1;
    const w = remarkWidth(ctx, m.text);
    const x = m.x - w / 2 - REMARK_PAD_X;
    // 底衬色与文字色**必须逐条交替**:绘制顺序是[底衬 -> 描边 -> 字]逐条画完,
    // 想让底衬全画完再画字就成了另一个 z 序(直接改变外观)。所以这里不跳 fillStyle。
    ctx.fillStyle = raised;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, m.y - REMARK_H / 2, w + REMARK_PAD_X * 2, REMARK_H, REMARK_RADIUS);
    } else {
      ctx.rect(x, m.y - REMARK_H / 2, w + REMARK_PAD_X * 2, REMARK_H);
    }
    ctx.fill();
    // 描边色与线宽逐条相同:值没变就不写(颜色 setter 每次都要重新解析一遍色串)
    if (stroke !== border) {
      ctx.strokeStyle = border;
      stroke = border;
    }
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.fillText(m.text, m.x, m.y);
  }
  ctx.globalAlpha = 1;
  ctx.textBaseline = 'alphabetic'; // 还原:后面的节点标签按 alphabetic 基线算 y
}
