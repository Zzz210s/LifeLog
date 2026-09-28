/**
 * 把绘制指令画到 canvas:
 * - 按 devicePixelRatio 设置后备缓冲(尺寸取整,避免半像素模糊)
 * - 颜色一律从主题令牌读,不写死色值
 * - `plan` 引用不变且 `themeKey` 不变时**不重绘** —— 设计 §3.3 的「静止 0 CPU」就靠这条。
 *   约定:plan 是 (节点 / 边 / 相机 / 视口尺寸) 的纯函数,尺寸变化必然伴随新 plan 对象,
 *   所以"尺寸变而 plan 未变"按内容未变处理:不重绘,也不动后备缓冲。
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { DrawPlan, Segment } from './graph-draw-plan';

/** 读主题令牌(亮暗切换后值会变,故颜色是"画的时候"读的);令牌缺失时退回 transparent */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'transparent';
}

function strokeAll(
  ctx: CanvasRenderingContext2D,
  segs: readonly Segment[],
  color: string,
  lineWidth: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  for (const s of segs) {
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
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
    strokeAll(ctx, p.plan.co, token('--color-border'), 1);
    strokeAll(ctx, p.plan.tree, token('--color-border-strong'), 1.5);
    for (const d of p.plan.dots) {
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = token('--color-muted');
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const l of p.plan.labels) ctx.fillText(l.text, l.x, l.y);
  }, [p.plan, p.width, p.height, p.themeKey]);

  return <canvas ref={ref} style={{ width: p.width, height: p.height }} />;
}
