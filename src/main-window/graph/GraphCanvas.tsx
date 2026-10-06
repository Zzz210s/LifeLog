/**
 * 把绘制指令画到 canvas:
 * - 按 devicePixelRatio 设置后备缓冲(尺寸取整,避免半像素模糊)
 * - 颜色一律从主题令牌读,不写死色值;**弱化只改 globalAlpha,不换颜色**(G2)
 * - 线宽:强调边(与焦点相连)2.5,其余按类型(共现 1 / 父子 1.5 / 链接 1.5 / 关系 1.5)
 * - 弱化的归位只在点循环后一处(`ctx.globalAlpha = 1`)——下面三段都不参与弱化,
 *   它们各自不靠「上一段恰好恢复成 1」活着,这一行也就成了可被用例钉住的单点
 * - 绘制顺序:共现边 -> 父子边 -> 链接边 -> 关系边 -> 点 -> 选中环 -> 展开的笔记小圆 -> 关系备注与文字
 * - 关系边与链接边同色同宽,只有它在**终点画实心箭头**;箭头尖从目标圆心回收一段,免得被后画的点盖住
 * - `plan` 引用不变且 `themeKey` 不变时**不重绘** —— 设计 §3.3 的「静止 0 CPU」就靠这条。
 *   约定:plan 是 (节点 / 边 / 相机 / 视口尺寸 / 强调态) 的纯函数,尺寸变化必然伴随新 plan 对象,
 *   所以"尺寸变而 plan 未变"按内容未变处理:不重绘,也不动后备缓冲。
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { DrawPlan, Segment } from './graph-draw-plan';
import { NOTE_R } from './graph-notes';
import { token } from './token';

/** 弱化透明度:足够暗到让焦点跳出来,又还能看出图的结构 */
const DIM_ALPHA = 0.2;
/** 共现边的基础不透明度(设计 D5:最弱一档,压到父子边之下) */
const CO_ALPHA = 0.6;
/** 枢纽外环半径增量与线宽(屏幕像素) */
const HUB_RING_GAP = 3;
const HUB_RING_WIDTH = 2;
/** 强调边(与焦点相连)的线宽:比同类型普通边明显粗一档(设计 §5「邻居边加粗」) */
const EMPHASIS_WIDTH = 2.5;
/** 选中环离点的间距(屏幕像素):点小时不至于贴在一起 */
const RING_GAP = 3;
/** 关系边箭头:边长与箭头尖离目标圆心的回收量(屏幕像素) */
const ARROW_SIZE = 7;
const ARROW_PULLBACK = 10;

function strokeAll(
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
  // 这里不归位:每段自己设 alpha,而边之后的绘制对象统一由点循环后的归位接住(见下)
}

/**
 * 关系边层:与 `strokeAll` 同一套粗细/透明度口径,但每条线在**终点**多画一个实心箭头 ——
 * 这是它与同色同宽的笔记链接边唯一的区别(方向 = 「A 具有 B 所表示的属性」)。
 */
function strokeRelations(ctx: CanvasRenderingContext2D, segs: readonly Segment[], color: string): void {
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
    const back = Math.min(ARROW_PULLBACK, len / 2);
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

export function GraphCanvas(p: {
  plan: DrawPlan;
  width: number;
  height: number;
  /** 主题标识(亮/暗):变化时必须重绘 */
  themeKey: string;
}): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawnPlan = useRef<DrawPlan | null>(null);
  const drawnTheme = useRef('');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (drawnPlan.current === p.plan && drawnTheme.current === p.themeKey) return;
    const ctx = el.getContext('2d');
    if (!ctx) return; // 拿不到上下文就不记账,留待下次重绘再试
    drawnPlan.current = p.plan;
    drawnTheme.current = p.themeKey;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(p.width * dpr);
    const bh = Math.round(p.height * dpr);
    if (el.width !== bw) el.width = bw;
    if (el.height !== bh) el.height = bh;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, p.width, p.height);
    // 三档(设计 D5):共现边最弱(1px + 60%),父子边居中(1.5px),链接边最醒目(accent)
    strokeAll(ctx, p.plan.co, token('--color-border'), 1, CO_ALPHA);
    strokeAll(ctx, p.plan.tree, token('--color-border-strong'), 1.5);
    // 笔记间的链接边:accent 色 1.5 —— 与共现/父子边同一根线但醒目一档(D12);零硬编码色值
    strokeAll(ctx, p.plan.links, token('--color-accent'), 1.5);
    // 标签关系边(带箭头,Task 5):空层不碰令牌,免得给既有用例多记一笔设色
    if (p.plan.relations.length > 0) {
      strokeRelations(ctx, p.plan.relations, token('--color-accent'));
    }
    for (const d of p.plan.dots) {
      ctx.globalAlpha = d.dim ? DIM_ALPHA : 1;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 聚合圆的计数(设计 D1):低缩放时一个圆代表多个节点,把数字画在圆心上。
    // 颜色取画布底(与圆形成对比),字号固定 11px 屏幕像素。
    const agg = p.plan.dots.filter((d) => (d.count ?? 1) > 1);
    if (agg.length > 0) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = token('--color-raised');
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const d of agg) ctx.fillText(String(d.count), d.x, d.y);
    }
    // 归位单点:环 / 笔记小圆 / `+N` / 文字都不参与弱化,谁不继承上面任何一次的 0.2
    // (去掉这一行,暗点或暗边之后的环、小圆、文字会一起变淡 —— 有用例钉住)
    ctx.globalAlpha = 1;
    // 枢纽外环(设计 D6):度数高的节点加一圈细环,让骨架里的关键节点一眼可辨。
    // 用 muted 而非 accent —— accent 留给"选中",两者不能撞语义。
    const hubs = p.plan.hubs ?? [];
    if (hubs.length > 0) {
      ctx.strokeStyle = token('--color-border-strong');
      ctx.lineWidth = HUB_RING_WIDTH;
      for (const h of hubs) {
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r + HUB_RING_GAP, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // 选中环:accent 描边,与弱化解耦(选中的点即使被弱化也要看得见环)
    const rings = p.plan.dots.filter((d) => d.selected);
    if (rings.length > 0) {
      ctx.strokeStyle = token('--color-accent');
      ctx.lineWidth = 2;
      for (const d of rings) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r + RING_GAP, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // 展开的笔记小圆:空心小圆,不参与弱化(被主动展开的永远清晰)
    if (p.plan.notes.length > 0) {
      ctx.strokeStyle = token('--color-border-strong');
      ctx.lineWidth = 1;
      for (const n of p.plan.notes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, NOTE_R, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = token('--color-muted');
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    if (p.plan.overflow !== null) {
      ctx.fillText(`+${p.plan.overflow.n}`, p.plan.overflow.x, p.plan.overflow.y);
    }
    for (const l of p.plan.labels) ctx.fillText(l.text, l.x, l.y);
    // 关系边的文字备注(箭头中点;绘制计划只在 k >= 1.2 时给出)
    for (const m of p.plan.relationMarks) ctx.fillText(m.text, m.x, m.y);
  }, [p.plan, p.width, p.height, p.themeKey]);

  return <canvas ref={ref} style={{ width: p.width, height: p.height }} />;
}
