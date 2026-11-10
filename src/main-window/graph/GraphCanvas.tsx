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
import { paint } from '../../../packages/graph-core/src/paint/paint';
import { setToken } from '../../../packages/graph-core/src/paint/tokens';
import { token } from './token';

setToken(token);


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
    // 绘制层已抽到 packages/graph-core/src/paint（软件与插件共用同一份）
    paint(ctx, p.plan, p.width, p.height);
  }, [p.plan, p.width, p.height, p.themeKey]);

  return <canvas ref={ref} style={{ width: p.width, height: p.height }} />;
}
