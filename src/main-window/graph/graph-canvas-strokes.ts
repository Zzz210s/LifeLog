/**
 * 画布上的两层描边(自 `GraphCanvas.tsx` 分出,守 200 行红线):普通边层与关系边层。
 * 2026-10-06 边视觉重做后的口径:
 * - 父子(轴色)边:取父节点根轴色(段上 `color`)、**实线** 1.5px、基础 70%;弱化 25%
 * - 共现(弱关联)边:border-strong **虚线(6/3)** 1.25px、基础 65%(2026-10-06 提亮加粗加长);弱化 15%
 * - 笔记链接边:accent **点线(1/4)** 1.5px;弱化 15%
 * - 标签关系边:accent 实线 1.5px + 终点箭头(与链接边同色同宽,箭头是唯一区别)
 *
 * 段自己的 `color` 优先于层默认色;`alpha` 是计划层给的显式读数(同轴边 100%),
 * 没给才退回「层基础值 / 层弱化值」。虚线/点线一律走 `setLineDash`,且**每层画完复位** ——
 * 不复位会漏到后面的点与文字上(常见坑)。
 *
 * **批次合并(2026-10-06)**:同层内按 (色, 透明度, 线宽) 分组,一组拼成一条 path、一次 `stroke()`。
 * 逐边 stroke 在展开时间轴时是 1540 次/帧(中位 11.7ms、偶发 >16.7ms);合并后一组一次。
 * 已知代价(用户已接受):**同组内**交叉的边不再叠加变深 —— canvas 的一次 `stroke()` 把整条 path
 * 当一个组合并光栅化,重叠处只画一遍。共现边(0.5 叠 0.5 = 0.75)与同轴色的父子边都会失去
 * 那种「交叉处更深」的层次,这是换掉逐边绘制的直接结果。
 * 线型仍是**每层一次** `setLineDash`(组内同线型),分组键不含线型。
 */
import { DIM_ALPHA, EDGE_DIM_ALPHA, SOLID_DASH } from './graph-edge-style';
import type { Segment } from './graph-draw-plan-types';

/** 强调边(与焦点相连)的线宽:比同类型普通边明显粗一档(设计 §5「邻居边加粗」) */
const EMPHASIS_WIDTH = 2.5;
/** 关系边箭头:边长与缺省回收量(屏幕像素;实际回收量优先取 `Segment.pullback`) */
const ARROW_SIZE = 7;
const ARROW_PULLBACK = 10;
/**
 * 单条 path 的 bbox 跨度上限(屏幕像素)与子路径数上限。
 * 为什么不是「一组一条 path」:一次 `stroke()` 的损售区是整个 path 的 bbox,许多边散在画布各处时
 * 包围盒 = 整个画布,实测比逐边还慢(chunk 16 -> 12ms,单条巨 path -> 12.2ms,逐边 -> 6.9ms)。
 * 改成「按 bbox 攒批」:bbox 超过 SPAN 或子路径数到 MAX 就 flush —— 既不丢批次收益,也不让
 * 任何一条 path 的 bbox 盖住整张画布。
 */
const BATCH_SPAN = 180;
const BATCH_MAX = 32;

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
  ctx.strokeStyle = color; // 空层也设一次:与既有「三层各取一次色」口径一致
  // 线型**每层一次**:实测 8 次/帧(4 层各两次),不是每条边一次;`setLineDash` 不留用入参,
  // 所以直接给模块常量而不每帧复制一份(2026-10-06 性能轮,少 4 次小分配/帧)
  ctx.setLineDash(dash as number[]);

  // 分组:键 = (色, 透明度, 线宽)。Map 保持首次出现顺序,于是绘制顺序仍是「先出现的组先画」。
  interface Group {
    color: string;
    alpha: number;
    width: number;
    segs: Segment[];
  }
  const groups = new Map<string, Group>();
  for (const s of segs) {
    const c = s.color ?? color;
    // 强调边不被弱化压下去(加粗了还变淡反而看不清);同轴边的 100% 由计划层的 alpha 给
    const a = s.alpha ?? (s.dim && !s.emphasized ? dimAlpha : baseAlpha);
    const w = s.emphasized ? EMPHASIS_WIDTH : baseWidth;
    const key = `${c}\u0000${a}\u0000${w}`;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, { color: c, alpha: a, width: w, segs: [s] });
    else g.segs.push(s);
  }

  let current = color;
  for (const g of groups.values()) {
    if (g.color !== current) {
      ctx.strokeStyle = g.color;
      current = g.color;
    }
    ctx.globalAlpha = g.alpha;
    ctx.lineWidth = g.width;
    // bbox 攒批:超出跨度/条数就先把当前的 path 画掉(见 BATCH_SPAN 注释)
    let open = false;
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    let n = 0;
    for (const s of g.segs) {
      const x1 = Math.min(s.x1, s.x2);
      const x2 = Math.max(s.x1, s.x2);
      const y1 = Math.min(s.y1, s.y2);
      const y2 = Math.max(s.y1, s.y2);
      if (open && (n >= BATCH_MAX || x2 - minX > BATCH_SPAN || maxX - x1 > BATCH_SPAN || y2 - minY > BATCH_SPAN || maxY - y1 > BATCH_SPAN)) {
        ctx.stroke();
        open = false;
      }
      if (!open) {
        ctx.beginPath();
        open = true;
        minX = x1;
        maxX = x2;
        minY = y1;
        maxY = y2;
        n = 0;
      }
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      minX = Math.min(minX, x1);
      maxX = Math.max(maxX, x2);
      minY = Math.min(minY, y1);
      maxY = Math.max(maxY, y2);
      n += 1;
    }
    if (open) ctx.stroke();
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
  ctx.setLineDash(SOLID_DASH as number[]);
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
