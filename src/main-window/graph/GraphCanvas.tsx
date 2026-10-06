/**
 * 把绘制指令画到 canvas:
 * - 按 devicePixelRatio 设置后备缓冲(尺寸取整,避免半像素模糊)
 * - 颜色一律从主题令牌读,不写死色值;**弱化只改 globalAlpha,不换颜色**(G2)
 * - 线宽:强调边(与焦点相连)2.5,其余按类型(共现 1 / 父子 1.5 / 链接 1.5 / 关系 1.5)
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
import type { DrawPlan } from './graph-draw-plan';
import { CO_ALPHA, DIM_ALPHA, strokeAll, strokeRelations } from './graph-canvas-strokes';
import { NOTE_R } from './graph-notes';
import { token } from './token';

/** 枢纽外环半径增量与线宽(屏幕像素) */
const HUB_RING_GAP = 3;
const HUB_RING_WIDTH = 2;
/** 选中环离点的间距(屏幕像素):点小时不至于贴在一起 */
const RING_GAP = 3;
/** 关系备注底衬胶囊:左右内边距 / 高度 / 圆角(屏幕像素) */
const REMARK_PAD_X = 4;
const REMARK_H = 16;
const REMARK_RADIUS = 4;

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
    // 关系备注画在节点标签**之前**:标签是读图主体,备注是补充信息,先画才不会反过来压住标签。
    // 每条备注垫一层底衷胶囊(raised 底 + border 描边)再写字 —— 否则 12px muted 字直接压在
    // 同字体同色的标签堆上,肉眼读不出(2026-10-05 截图复核的 C1);`dim` 让弱化也作用到它。
    if (p.plan.relationMarks.length > 0) {
      ctx.textBaseline = 'middle';
      for (const m of p.plan.relationMarks) {
        ctx.globalAlpha = m.dim ? DIM_ALPHA : 1;
        const w = ctx.measureText(m.text).width;
        const x = m.x - w / 2 - REMARK_PAD_X;
        ctx.fillStyle = token('--color-raised');
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, m.y - REMARK_H / 2, w + REMARK_PAD_X * 2, REMARK_H, REMARK_RADIUS);
        } else {
          ctx.rect(x, m.y - REMARK_H / 2, w + REMARK_PAD_X * 2, REMARK_H);
        }
        ctx.fill();
        ctx.strokeStyle = token('--color-border');
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = token('--color-muted');
        ctx.fillText(m.text, m.x, m.y);
      }
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'alphabetic'; // 还原:后面的节点标签按 alphabetic 基线算 y
    }
    for (const l of p.plan.labels) ctx.fillText(l.text, l.x, l.y);
  }, [p.plan, p.width, p.height, p.themeKey]);

  return <canvas ref={ref} style={{ width: p.width, height: p.height }} />;
}
