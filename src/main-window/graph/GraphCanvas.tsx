/**
 * 把绘制指令画到 canvas:
 * - 按 devicePixelRatio 设置后备缓冲(尺寸取整,避免半像素模糊)
 * - 颜色一律从主题令牌读,不写死色值;**弱化只改 globalAlpha,不换颜色**(G2)
 * - 线宽:强调边(与焦点相连)2.5,其余按类型(共现 1.25 / 父子 1.5 / 链接 1.5 / 关系 1.5)
 * - 线型(2026-10-06 边视觉重做):父子边**实线取父节点轴色**、共现边**中性色虚线**、
 *   笔记链接边 **accent 点线**、关系边 accent 实线 + 箭头
 * - 弱化的归位只在点循环后一处(`ctx.globalAlpha = 1`)——下面三段都不参与弱化,
 *   它们各自不靠「上一段恰好恢复成 1」活着,这一行也就成了可被用例钉住的单点
 * - 绘制顺序:共现边 -> 父子边 -> 链接边 -> 关系边 -> 点 -> 选中环 -> 展开的笔记小圆 -> 关系备注 -> 文字
 * - 关系边与链接边同色同宽,只有它在**终点画实心箭头**;箭头尖按目标半径 + 余量回收,免得被后画的点盖住
 * - `plan` 引用不变且 `themeKey` 不变时**不重绘** —— 设计 §3.3 的「静止 0 CPU」就靠这条。
 *   约定:plan 是 (节点 / 边 / 相机 / 视口尺寸 / 强调态) 的纯函数,尺寸变化必然伴随新 plan 对象,
 *   所以"尺寸变而 plan 未变"按内容未变处理:不重绘,也不动后备缓冲。
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Dot, DrawPlan } from './graph-draw-plan';
import { CO_ALPHA, CO_DASH, DIM_ALPHA, EDGE_DIM_ALPHA, AXIS_DIM_ALPHA, LINK_DASH, TREE_ALPHA } from './graph-edge-style';
import { strokeAll, strokeRelations } from './graph-canvas-strokes';
import { drawRelationMarks } from './graph-canvas-remarks';
import { NOTE_R } from './graph-notes';
import { token } from './token';

/** 枢纽外环半径增量与线宽(屏幕像素) */
const HUB_RING_GAP = 3;
const HUB_RING_WIDTH = 2;
/** 选中环离点的间距(屏幕像素):点小时不至于贴在一起 */
const RING_GAP = 3;

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
    // 四档边(2026-10-06 重做):共现 = border-strong 虚线 65%;父子 = 父节点轴色实线 70%;
    // 笔记链接 = accent 点线;关系边 = accent 实线 + 箭头。零硬编码色值,全走令牌/轴色。
    strokeAll(ctx, p.plan.co, token('--color-border-strong'), 1.25, CO_ALPHA, { dimAlpha: EDGE_DIM_ALPHA, dash: CO_DASH });
    strokeAll(ctx, p.plan.tree, token('--color-border-strong'), 1.5, TREE_ALPHA, { dimAlpha: AXIS_DIM_ALPHA });
    strokeAll(ctx, p.plan.links, token('--color-accent'), 1.5, 1, { dimAlpha: EDGE_DIM_ALPHA, dash: LINK_DASH });
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
    // 聚合圆与选中环在同一遍循环里分开收:两趟 filter 每帧多一个数组(2026-10-06 性能轮)
    const agg: Dot[] = [];
    const rings: Dot[] = [];
    for (const d of p.plan.dots) {
      if ((d.count ?? 1) > 1) agg.push(d);
      if (d.selected) rings.push(d);
    }
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
    // 关系备注画在节点标签**之前**:标签是读图主体,备注是补充信息,先画才不会反过来压住标签。
    // 底衬胶囊、字宽缓存与令牌读数在 graph-canvas-remarks(空层不碰令牌)
    drawRelationMarks(ctx, p.plan.relationMarks);
    for (const l of p.plan.labels) ctx.fillText(l.text, l.x, l.y);
  }, [p.plan, p.width, p.height, p.themeKey]);

  return <canvas ref={ref} style={{ width: p.width, height: p.height }} />;
}
